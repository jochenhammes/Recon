import type { DicomSourceFile, VolumeSource } from "../dataset/types";
import type { Volume3D } from "../viewer/volume";
import { encodePixels } from "./pixelEncode";
import { EXPLICIT_VR_LE, type TagOverrides, formatDS, rewriteDicom, stringValue, tagKey, usValue } from "./dicomRewriter";
import { generateUid } from "./uid";

export type DicomSource = Extract<VolumeSource, { kind: "dicom" }>;

export interface EditedDicomOptions {
  /** Appended to SeriesDescription (0008,103E), e.g. " [bearbeitet]". Empty = unchanged. */
  seriesDescriptionSuffix?: string;
  /** Written to DerivationDescription (0008,2111) if given. */
  derivationDescription?: string;
}

export interface ExportedFile {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface EditedDicomResult {
  files: ExportedFile[];
  warnings: string[];
}

const T = {
  MediaStorageSopInstanceUid: tagKey(0x0002, 0x0003),
  TransferSyntaxUid: tagKey(0x0002, 0x0010),
  ImageType: tagKey(0x0008, 0x0008),
  SopInstanceUid: tagKey(0x0008, 0x0018),
  SeriesDescription: tagKey(0x0008, 0x103e),
  DerivationDescription: tagKey(0x0008, 0x2111),
  SeriesInstanceUid: tagKey(0x0020, 0x000e),
  BitsAllocated: tagKey(0x0028, 0x0100),
  BitsStored: tagKey(0x0028, 0x0101),
  HighBit: tagKey(0x0028, 0x0102),
  RescaleIntercept: tagKey(0x0028, 0x1052),
  RescaleSlope: tagKey(0x0028, 0x1053),
  PixelData: tagKey(0x7fe0, 0x0010),
} as const;

/** Value-range tags that become stale when pixel values change; they are Type 3 and simply removed. */
const STALE_RANGE_TAGS = [tagKey(0x0028, 0x0106), tagKey(0x0028, 0x0107), tagKey(0x0028, 0x0108), tagKey(0x0028, 0x0109)];

/**
 * Writes the (edited) volume back into the original DICOM file(s). All header elements are copied
 * unchanged except: PixelData, SOP Instance UID (new), Series Instance UID (new, shared by all files),
 * ImageType value 1 → DERIVED, optional SeriesDescription suffix / DerivationDescription, and — only
 * if the new values cannot be stored with the original encoding — bit depth and rescale tags.
 * Compressed (JPEG Lossless) originals are written uncompressed (Explicit VR Little Endian).
 */
export function buildEditedDicomFiles(volume: Volume3D, source: DicomSource, opts: EditedDicomOptions = {}): EditedDicomResult {
  const sliceSize = volume.nx * volume.ny;
  const totalFrames = source.files.reduce((s, f) => s + f.nFrames, 0);
  if (totalFrames !== volume.nz) throw new Error("Volumengröße passt nicht mehr zu den Original-DICOM-Dateien.");

  const seriesUid = generateUid();
  const warnings: string[] = [];
  const usedNames = new Set<string>();
  const files = source.files.map((file) => {
    const values = volume.data.subarray(file.zStart * sliceSize, (file.zStart + file.nFrames) * sliceSize);
    const { overrides, warning } = buildFileOverrides(file, values, seriesUid, opts);
    if (warning) warnings.push(warning);
    return { name: uniqueName(file.fileName, usedNames), bytes: rewriteDicom(file, overrides) };
  });
  return { files, warnings };
}

function buildFileOverrides(file: DicomSourceFile, values: Float32Array, seriesUid: string, opts: EditedDicomOptions) {
  const { dataSet } = file;
  const encoded = encodePixels(values, file.encoding);
  const enc = encoded.encoding;
  const overrides: TagOverrides = new Map();
  const notes: string[] = [];

  if (dataSet.elements[T.PixelData]?.encapsulatedPixelData) {
    overrides.set(T.TransferSyntaxUid, stringValue("UI", EXPLICIT_VR_LE));
    notes.push("komprimierte Pixeldaten unkomprimiert gespeichert");
  }
  overrides.set(T.PixelData, { vr: enc.bitsAllocated === 8 ? "OB" : "OW", value: encoded.bytes });

  if (encoded.rescaled) {
    if (enc.bitsAllocated !== file.encoding.bitsAllocated || enc.bitsStored !== file.encoding.bitsStored) {
      overrides.set(T.BitsAllocated, usValue(enc.bitsAllocated));
      overrides.set(T.BitsStored, usValue(enc.bitsStored));
      overrides.set(T.HighBit, usValue(enc.bitsStored - 1));
    }
    if (enc.hasRescaleTags) {
      overrides.set(T.RescaleSlope, stringValue("DS", formatDS(enc.slope)));
      overrides.set(T.RescaleIntercept, stringValue("DS", formatDS(enc.intercept)));
    }
    notes.push(
      `Skalierung angepasst (Slope ${formatDS(enc.slope)}, Intercept ${formatDS(enc.intercept)}, ` +
        `${enc.bitsStored} bit, max. Rundungsabweichung ${formatDS(encoded.maxError)})`,
    );
  }
  for (const tag of STALE_RANGE_TAGS) if (dataSet.elements[tag]) overrides.set(tag, null);

  const sopUid = generateUid();
  overrides.set(T.SopInstanceUid, stringValue("UI", sopUid));
  if (dataSet.elements[T.MediaStorageSopInstanceUid]) overrides.set(T.MediaStorageSopInstanceUid, stringValue("UI", sopUid));
  overrides.set(T.SeriesInstanceUid, stringValue("UI", seriesUid));

  const imageType = dataSet.string(T.ImageType);
  if (imageType) {
    const parts = imageType.split("\\");
    if (parts[0].trim() !== "DERIVED") {
      parts[0] = "DERIVED";
      overrides.set(T.ImageType, stringValue("CS", parts.join("\\")));
    }
  }
  if (opts.seriesDescriptionSuffix) {
    const desc = `${(dataSet.string(T.SeriesDescription) ?? "").trim()}${opts.seriesDescriptionSuffix}`.trim().slice(0, 64);
    overrides.set(T.SeriesDescription, stringValue("LO", desc));
  }
  if (opts.derivationDescription) {
    overrides.set(T.DerivationDescription, stringValue("ST", opts.derivationDescription.slice(0, 1024)));
  }

  return { overrides, warning: notes.length > 0 ? `${file.fileName}: ${notes.join("; ")}` : undefined };
}

function uniqueName(name: string, used: Set<string>): string {
  let candidate = name || "image.dcm";
  let i = 1;
  while (used.has(candidate.toLowerCase())) {
    const dot = name.lastIndexOf(".");
    candidate = dot > 0 ? `${name.slice(0, dot)}_${i}${name.slice(dot)}` : `${name}_${i}`;
    i++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}
