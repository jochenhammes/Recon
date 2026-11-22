import type { DicomSourceFile, VolumeSource } from "../dataset/types";
import type { Volume3D } from "../viewer/volume";
import { type EncodedPixels, encodePixels } from "./pixelEncode";
import { EXPLICIT_VR_LE, type TagOverrides, formatDS, rewriteDicom, stringValue, tagKey, usValue } from "./dicomRewriter";
import { type AnonymizeContext, type AnonymizeOptions, addAnonymizationOverrides, createAnonymizeContext } from "./anonymize";
import { generateUid } from "./uid";
import { type HeaderEdit, applyHeaderEdits } from "../header/headerModel";

import { t } from "../i18n";
export type DicomSource = Extract<VolumeSource, { kind: "dicom" }>;

export interface EditedDicomOptions {
  /** Appended to SeriesDescription (0008,103E), e.g. " [bearbeitet]". Empty = unchanged. */
  seriesDescriptionSuffix?: string;
  /** Written to DerivationDescription (0008,2111) if given. */
  derivationDescription?: string;
  /**
   * Re-derive Window Center/Width (0028,1050/1051) from the exported value range instead of keeping
   * the original window, which no longer fits after an edit. Only applied where the original has a window.
   */
  adjustWindow?: boolean;
  /** De-identify patient, institution and device information; files are renamed IM00001.dcm, … */
  anonymize?: AnonymizeOptions;
  /** User header changes (header editor), applied last. */
  headerEdits?: HeaderEdit[];
}

export interface ExportedFile {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface EditedDicomResult {
  files: ExportedFile[];
  warnings: string[];
}

export const T = {
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
  SmallestImagePixelValue: tagKey(0x0028, 0x0106),
  LargestImagePixelValue: tagKey(0x0028, 0x0107),
  SmallestPixelValueInSeries: tagKey(0x0028, 0x0108),
  LargestPixelValueInSeries: tagKey(0x0028, 0x0109),
  WindowCenter: tagKey(0x0028, 0x1050),
  WindowWidth: tagKey(0x0028, 0x1051),
  WindowExplanation: tagKey(0x0028, 0x1055),
  VoiLutSequence: tagKey(0x0028, 0x3010),
  RescaleIntercept: tagKey(0x0028, 0x1052),
  RescaleSlope: tagKey(0x0028, 0x1053),
  PixelData: tagKey(0x7fe0, 0x0010),
} as const;


/**
 * Writes the (edited) volume back into the original DICOM file(s). All header elements are copied
 * unchanged except: PixelData, SOP Instance UID (new), Series Instance UID (new, shared by all files),
 * ImageType value 1 → DERIVED, optional SeriesDescription suffix / DerivationDescription, Smallest/
 * Largest Pixel Value tags (rewritten with the new values), optionally Window Center/Width, and — only
 * if the new values cannot be stored with the original encoding — bit depth and rescale tags.
 * Compressed (JPEG Lossless) originals are written uncompressed (Explicit VR Little Endian).
 */
export function buildEditedDicomFiles(volume: Volume3D, source: DicomSource, opts: EditedDicomOptions = {}): EditedDicomResult {
  const sliceSize = volume.nx * volume.ny;
  const totalFrames = source.files.reduce((s, f) => s + f.nFrames, 0);
  const first = source.files[0].dataSet;
  if (totalFrames !== volume.nz || first.uint16("x00280010") !== volume.ny || first.uint16("x00280011") !== volume.nx)
    throw new Error(t("Das Voxelraster wurde verändert (Crop/Drehen/Resampling) und passt nicht mehr zu den Original-DICOM-Dateien."));

  const encodedFiles = source.files.map((file) =>
    encodePixels(volume.data.subarray(file.zStart * sliceSize, (file.zStart + file.nFrames) * sliceSize), file.encoding),
  );

  // Series-wide stored range (only meaningful if all files share one encoding) and real-value range.
  const sameEncoding = encodedFiles.every((e) => sameStoredEncoding(e, encodedFiles[0]));
  const series = {
    storedMin: Math.min(...encodedFiles.map((e) => e.storedMin)),
    storedMax: Math.max(...encodedFiles.map((e) => e.storedMax)),
    sameEncoding,
    window: realWindow(volume.data),
  };

  const seriesUid = generateUid();
  const warnings: string[] = [];
  const usedNames = new Set<string>();
  const anon = opts.anonymize ? createAnonymizeContext(opts.anonymize) : undefined;
  const files = source.files.map((file, i) => {
    const { overrides, warning } = buildFileOverrides(file, encodedFiles[i], seriesUid, series, opts, anon);
    applyHeaderEdits(overrides, opts.headerEdits, i, file);
    if (warning) warnings.push(anon ? t("Datei {v}: {v2}", { v: i + 1, v2: warning.slice(file.fileName.length + 2) }) : warning);
    const name = anon ? t("IM{v}.dcm", { v: String(i + 1).padStart(5, "0") }) : uniqueName(file.fileName, usedNames);
    return { name, bytes: rewriteDicom(file, overrides) };
  });
  const snapped = encodedFiles.filter((e) => e.snapped);
  if (snapped.length > 0) {
    const maxError = Math.max(...snapped.map((e) => e.maxError));
    warnings.unshift(
      t("Neuer Wert in {length} von {length2} Datei(en) auf das Original-Werteraster gerundet ", { length: snapped.length, length2: encodedFiles.length }) +
        t("(max. Abweichung {v}); Skalierung unverändert.", { v: formatDS(maxError) }),
    );
  }
  return { files, warnings };
}

interface SeriesInfo {
  storedMin: number;
  storedMax: number;
  sameEncoding: boolean;
  window: { center: number; width: number };
}

function sameStoredEncoding(a: EncodedPixels, b: EncodedPixels): boolean {
  const x = a.encoding;
  const y = b.encoding;
  return x.bitsAllocated === y.bitsAllocated && x.pixelRepresentation === y.pixelRepresentation && x.slope === y.slope && x.intercept === y.intercept;
}

/** Linear window covering the full range of (finite) real values. */
export function realWindow(data: Float32Array): { center: number; width: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return { center: 0, width: 1 };
  return { center: (min + max) / 2, width: Math.max(max - min, 1) };
}

/** US/SS value for the pixel-value range tags, whose VR follows PixelRepresentation. */
export function pixelValue(v: number, pixelRepresentation: number): { vr: string; value: Uint8Array } {
  const value = new Uint8Array(2);
  const dv = new DataView(value.buffer);
  if (pixelRepresentation === 1) dv.setInt16(0, v, true);
  else dv.setUint16(0, v, true);
  return { vr: pixelRepresentation === 1 ? "SS" : "US", value };
}

function buildFileOverrides(
  file: DicomSourceFile,
  encoded: EncodedPixels,
  seriesUid: string,
  series: SeriesInfo,
  opts: EditedDicomOptions,
  anon?: AnonymizeContext,
) {
  const { dataSet } = file;
  const enc = encoded.encoding;
  const overrides: TagOverrides = new Map();
  // De-identification first; the export-specific overrides below take precedence where they overlap.
  if (anon) addAnonymizationOverrides(dataSet, anon, overrides);
  const notes: string[] = [];

  if (dataSet.elements[T.PixelData]?.encapsulatedPixelData) {
    overrides.set(T.TransferSyntaxUid, stringValue("UI", EXPLICIT_VR_LE));
    notes.push(t("komprimierte Pixeldaten unkomprimiert gespeichert"));
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
      t("Skalierung angepasst (Slope {v}, Intercept {v2}, ", { v: formatDS(enc.slope), v2: formatDS(enc.intercept) }) +
        t("{bitsStored} bit, max. Rundungsabweichung {v})", { bitsStored: enc.bitsStored, v: formatDS(encoded.maxError) }),
    );
  }

  // Smallest/Largest (Image|Series) Pixel Value: rewrite with the new stored values where present.
  // They are US/SS, so they cannot describe 32-bit samples; drop them in that case.
  const fits16 = enc.bitsAllocated <= 16;
  const rangeTags: [string, number, boolean][] = [
    [T.SmallestImagePixelValue, encoded.storedMin, fits16],
    [T.LargestImagePixelValue, encoded.storedMax, fits16],
    [T.SmallestPixelValueInSeries, series.storedMin, fits16 && series.sameEncoding],
    [T.LargestPixelValueInSeries, series.storedMax, fits16 && series.sameEncoding],
  ];
  for (const [tag, value, writable] of rangeTags) {
    if (!dataSet.elements[tag]) continue;
    overrides.set(tag, writable ? pixelValue(value, enc.pixelRepresentation) : null);
  }

  // Window: the original window refers to the original value range; re-derive it from the export.
  if (opts.adjustWindow && dataSet.elements[T.WindowCenter] && dataSet.elements[T.WindowWidth]) {
    overrides.set(T.WindowCenter, stringValue("DS", formatDS(series.window.center)));
    overrides.set(T.WindowWidth, stringValue("DS", formatDS(series.window.width)));
    // Keep VM consistent with the single window written above; a VOI LUT would take precedence.
    if (dataSet.elements[T.WindowExplanation]) overrides.set(T.WindowExplanation, stringValue("LO", "EDITED"));
    if (dataSet.elements[T.VoiLutSequence]) overrides.set(T.VoiLutSequence, null);
  }

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
  if (anon) {
    // Free-text descriptions may name the site or scanner model.
    overrides.set(T.SeriesDescription, stringValue("LO", t("ANONYMISIERT{v}", { v: opts.seriesDescriptionSuffix ?? "" }).slice(0, 64)));
  } else if (opts.seriesDescriptionSuffix) {
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
