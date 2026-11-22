import type { DicomSourceFile } from "../dataset/types";
import { cross, dot, normalize, voxelToWorld } from "../core/geometry";
import type { Volume3D } from "../viewer/volume";
import { type AnonymizeOptions, addAnonymizationOverrides, createAnonymizeContext } from "./anonymize";
import {
  EXPLICIT_VR_LE,
  IMPLICIT_VR_LE,
  type TagOverrides,
  encodeElementBytes,
  formatDS,
  rewriteDicom,
  sequenceValue,
  stringValue,
  tagKey,
  usArrayValue,
  usValue,
} from "./dicomRewriter";
import { type ExportedFile, T, pixelValue, realWindow } from "./editedDicomExport";
import { encodePixels } from "./pixelEncode";
import { generateUid } from "./uid";
import { type HeaderEdit, applyHeaderEdits } from "../header/headerModel";

import { t } from "../i18n";
export interface TemplateSeriesOptions {
  seriesDescription?: string;
  derivationDescription?: string;
  /** Frame of reference of the written geometry (e.g. the CT's for fused exports). */
  frameOfReferenceUid?: string;
  anonymize?: AnonymizeOptions;
  /** User header changes (header editor); file-specific edits refer to the template file 0. */
  headerEdits?: HeaderEdit[];
}

const G = {
  SliceThickness: tagKey(0x0018, 0x0050),
  SpacingBetweenSlices: tagKey(0x0018, 0x0088),
  InstanceNumber: tagKey(0x0020, 0x0013),
  ImagePositionPatient: tagKey(0x0020, 0x0032),
  ImageOrientationPatient: tagKey(0x0020, 0x0037),
  FrameOfReferenceUid: tagKey(0x0020, 0x0052),
  SliceLocation: tagKey(0x0020, 0x1041),
  NumberOfFrames: tagKey(0x0028, 0x0008),
  Rows: tagKey(0x0028, 0x0010),
  Columns: tagKey(0x0028, 0x0011),
  PixelSpacing: tagKey(0x0028, 0x0030),
  DetectorInformationSequence: tagKey(0x0054, 0x0022),
  SliceVector: tagKey(0x0054, 0x0080),
  NumberOfSlices: tagKey(0x0054, 0x0081),
  ImageIndex: tagKey(0x0054, 0x1330),
  SharedFunctionalGroups: tagKey(0x5200, 0x9229),
  PerFrameFunctionalGroups: tagKey(0x5200, 0x9230),
} as const;

const ds = (values: number[]) => values.map((v) => formatDS(Number(v.toFixed(6)))).join("\\");

/**
 * Writes a volume with an arbitrary voxel grid as a new DICOM series, using an original file as the
 * header template: all template elements are kept except geometry, pixel and identity tags.
 * Multi-frame templates (NM) produce one multi-frame file; single-frame templates (PET/CT/MR) one
 * file per slice.
 */
export function buildTemplateSeries(volume: Volume3D, template: DicomSourceFile, opts: TemplateSeriesOptions = {}): { files: ExportedFile[]; warnings: string[] } {
  const { dataSet } = template;
  if (dataSet.elements[G.PerFrameFunctionalGroups])
    throw new Error(t("Enhanced-Multiframe-DICOM kann nicht als Vorlage für ein neues Voxelraster dienen."));

  const g = volume.geometry;
  const { nx, ny, nz } = volume;
  const sliceSize = nx * ny;
  const multiFrame = template.nFrames > 1;
  const explicit = template.transferSyntax !== IMPLICIT_VR_LE;
  const seriesUid = generateUid();
  const window = realWindow(volume.data);
  const anon = opts.anonymize ? createAnonymizeContext(opts.anonymize) : undefined;
  const warnings: string[] = [];
  const normal = normalize(cross(g.axes[0], g.axes[1]));
  const iop = ds([...g.axes[0], ...g.axes[1]]);

  const geometryOverrides = (overrides: TagOverrides, k: number) => {
    const ipp = voxelToWorld(g, 0, 0, k);
    overrides.set(G.Rows, usValue(ny));
    overrides.set(G.Columns, usValue(nx));
    overrides.set(G.PixelSpacing, stringValue("DS", ds([g.spacing[1], g.spacing[0]])));
    overrides.set(G.SliceThickness, stringValue("DS", ds([g.spacing[2]])));
    if (dataSet.elements[G.SpacingBetweenSlices]) overrides.set(G.SpacingBetweenSlices, stringValue("DS", ds([g.spacing[2]])));
    overrides.set(G.ImagePositionPatient, stringValue("DS", ds(ipp)));
    overrides.set(G.ImageOrientationPatient, stringValue("DS", iop));
    if (dataSet.elements[G.SliceLocation]) overrides.set(G.SliceLocation, stringValue("DS", ds([dot(ipp, normal)])));
    if (opts.frameOfReferenceUid ?? g.frameOfReferenceUid)
      overrides.set(G.FrameOfReferenceUid, stringValue("UI", (opts.frameOfReferenceUid ?? g.frameOfReferenceUid)!));
    overrides.set(G.SharedFunctionalGroups, null);
  };

  const commonOverrides = (overrides: TagOverrides, values: Float32Array, frames: number) => {
    const encoded = encodePixels(values, template.encoding);
    const enc = encoded.encoding;
    if (dataSet.elements[T.PixelData]?.encapsulatedPixelData) overrides.set(T.TransferSyntaxUid, stringValue("UI", EXPLICIT_VR_LE));
    overrides.set(T.PixelData, { vr: enc.bitsAllocated === 8 ? "OB" : "OW", value: encoded.bytes });
    if (enc !== template.encoding) {
      overrides.set(T.BitsAllocated, usValue(enc.bitsAllocated));
      overrides.set(T.BitsStored, usValue(enc.bitsStored));
      overrides.set(T.HighBit, usValue(enc.bitsStored - 1));
    }
    if (enc.hasRescaleTags) {
      overrides.set(T.RescaleSlope, stringValue("DS", formatDS(enc.slope)));
      overrides.set(T.RescaleIntercept, stringValue("DS", formatDS(enc.intercept)));
    }
    const fits16 = enc.bitsAllocated <= 16;
    for (const [tag, v] of [
      [T.SmallestImagePixelValue, encoded.storedMin],
      [T.LargestImagePixelValue, encoded.storedMax],
    ] as [string, number][])
      if (dataSet.elements[tag]) overrides.set(tag, fits16 ? pixelValue(v, enc.pixelRepresentation) : null);
    for (const tag of [T.SmallestPixelValueInSeries, T.LargestPixelValueInSeries]) if (dataSet.elements[tag]) overrides.set(tag, null);
    if (dataSet.elements[T.WindowCenter] || dataSet.elements[T.WindowWidth]) {
      overrides.set(T.WindowCenter, stringValue("DS", formatDS(window.center)));
      overrides.set(T.WindowWidth, stringValue("DS", formatDS(window.width)));
      if (dataSet.elements[T.WindowExplanation]) overrides.set(T.WindowExplanation, stringValue("LO", "EDITED"));
    }
    if (dataSet.elements[T.VoiLutSequence]) overrides.set(T.VoiLutSequence, null);
    if (dataSet.elements[G.NumberOfFrames] || frames > 1) overrides.set(G.NumberOfFrames, stringValue("IS", String(frames)));
    overrides.set(T.SeriesInstanceUid, stringValue("UI", seriesUid));
    const sop = generateUid();
    overrides.set(T.SopInstanceUid, stringValue("UI", sop));
    if (dataSet.elements[T.MediaStorageSopInstanceUid]) overrides.set(T.MediaStorageSopInstanceUid, stringValue("UI", sop));
    const imageType = dataSet.string(T.ImageType);
    if (imageType) {
      const parts = imageType.split("\\");
      parts[0] = "DERIVED";
      overrides.set(T.ImageType, stringValue("CS", parts.join("\\")));
    }
    const desc = anon ? t("ANONYMISIERT {v}", { v: opts.seriesDescription ?? "" }).trim() : (opts.seriesDescription ?? dataSet.string(T.SeriesDescription) ?? "");
    overrides.set(T.SeriesDescription, stringValue("LO", desc.slice(0, 64)));
    if (opts.derivationDescription) overrides.set(T.DerivationDescription, stringValue("ST", opts.derivationDescription.slice(0, 1024)));
    if (encoded.rescaled) warnings.push(t("Skalierung angepasst (Slope {v}, Intercept {v2})", { v: formatDS(enc.slope), v2: formatDS(enc.intercept) }));
  };

  const newOverrides = (): TagOverrides => {
    const o: TagOverrides = new Map();
    if (anon) addAnonymizationOverrides(dataSet, anon, o);
    return o;
  };

  if (multiFrame) {
    const overrides = newOverrides();
    geometryOverrides(overrides, 0);
    commonOverrides(overrides, volume.data, nz);
    overrides.set(G.SliceVector, usArrayValue(Array.from({ length: nz }, (_, i) => i + 1)));
    if (dataSet.elements[G.NumberOfSlices]) overrides.set(G.NumberOfSlices, usValue(nz));
    // NM: the detector information sequence also carries the image plane; rebuild it with the new one.
    if (dataSet.elements[G.DetectorInformationSequence]) {
      const item = [
        encodeElementBytes(0x0020, 0x0032, stringValue("DS", ds(voxelToWorld(g, 0, 0, 0))), explicit),
        encodeElementBytes(0x0020, 0x0037, stringValue("DS", iop), explicit),
      ];
      overrides.set(G.DetectorInformationSequence, sequenceValue([concat(item)]));
    }
    applyHeaderEdits(overrides, opts.headerEdits, 0, template);
    return { files: [{ name: "IM00001.dcm", bytes: rewriteDicom(template, overrides) }], warnings: dedupe(warnings) };
  }

  const files: ExportedFile[] = [];
  for (let k = 0; k < nz; k++) {
    const overrides = newOverrides();
    geometryOverrides(overrides, k);
    commonOverrides(overrides, volume.data.subarray(k * sliceSize, (k + 1) * sliceSize), 1);
    overrides.set(G.InstanceNumber, stringValue("IS", String(k + 1)));
    if (dataSet.elements[G.ImageIndex]) overrides.set(G.ImageIndex, usValue(k + 1));
    if (dataSet.elements[G.NumberOfSlices]) overrides.set(G.NumberOfSlices, usValue(nz));
    applyHeaderEdits(overrides, opts.headerEdits?.filter((e) => e.scope === "all" || e.scope === 0), 0, template);
    files.push({ name: t("IM{v}.dcm", { v: String(k + 1).padStart(5, "0") }), bytes: rewriteDicom(template, overrides) });
  }
  return { files, warnings: dedupe(warnings) };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function dedupe(warnings: string[]): string[] {
  if (warnings.length <= 1) return warnings;
  return [t("{length} Schichten neu skaliert (Werte außerhalb des Vorlagen-Wertebereichs).", { length: warnings.length })];
}
