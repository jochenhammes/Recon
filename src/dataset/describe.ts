import { type SuvResult, computeSuv } from "../analysis/suv";
import type { LayerDisplay } from "../viewer/types";
import type { Volume3D } from "../viewer/volume";
import type { VolumeSource } from "./types";

/** Short modality label for chips and the status bar. */
export function modalityLabel(source: VolumeSource | undefined): string {
  if (!source) return "Volumen";
  if (source.kind === "reconstruction") return "SPECT";
  if (source.kind === "nifti") return "NIfTI";
  return source.files[0].dataSet.string("x00080060")?.trim() || "DICOM";
}

/** True for anatomical modalities that serve as the fusion base (CT, MR). */
export function isAnatomical(source: VolumeSource): boolean {
  const m = modalityLabel(source);
  return m === "CT" || m === "MR";
}

export function suvForSource(source: VolumeSource): SuvResult | null {
  return source.kind === "dicom" ? computeSuv(source.files[0].dataSet) : null;
}

export function rawUnitLabel(source: VolumeSource): string {
  if (source.kind !== "dicom") return "";
  const m = modalityLabel(source);
  if (m === "CT") return "HU";
  const units = source.files[0].dataSet.string("x00541001")?.trim();
  return units === "BQML" ? "Bq/ml" : (units ?? "");
}

/** Series description (if any) for display. */
export function seriesDescription(source: VolumeSource): string | undefined {
  if (source.kind !== "dicom") return undefined;
  return source.files[0].dataSet.string("x0008103e")?.trim() || undefined;
}

/** CT window presets (center/width in HU) as [min, max]. */
export const CT_PRESETS: { label: string; window: [number, number] }[] = [
  { label: "Weichteil", window: [-160, 240] },
  { label: "Lunge", window: [-1350, 150] },
  { label: "Knochen", window: [-450, 1050] },
  { label: "Gehirn", window: [0, 80] },
  { label: "Leber", window: [-25, 175] },
];

/**
 * Initial display: CT with a soft-tissue window; other data from 0 (or the minimum, if negative)
 * to the 99.5th percentile.
 */
export function defaultDisplay(volume: Volume3D, source?: VolumeSource): LayerDisplay {
  if (source && modalityLabel(source) === "CT") {
    return { window: CT_PRESETS[0].window, lut: "gray", opacity: 1, visible: true };
  }
  const hi = volume.percentile(99.5);
  let lo = 0;
  for (let i = 0; i < volume.data.length; i += 97) if (volume.data[i] < lo) lo = volume.data[i];
  return { window: [lo, hi > lo ? hi : lo + 1], lut: "gray", opacity: 1, visible: true };
}
