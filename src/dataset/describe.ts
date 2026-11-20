import { type SuvResult, computeSuv } from "../analysis/suv";
import type { LayerDisplay } from "../viewer/types";
import type { Volume3D } from "../viewer/volume";
import type { LoadedDataset, VolumeSource } from "./types";

/** Short modality label for chips and the status bar. */
export function modalityLabel(source: VolumeSource | undefined): string {
  if (!source) return "Volumen";
  return source.modality ?? autoModality(source);
}

/** Modality without the user's choice: header (DICOM), guess (NIfTI) or "SPECT" (own reconstruction). */
export function autoModality(source: VolumeSource): string {
  if (source.kind === "reconstruction") return "SPECT";
  if (source.kind === "nifti") return source.modalityGuess ?? "NIfTI";
  return source.files[0].dataSet.string("x00080060")?.trim() || "DICOM";
}

/** Modalities the user can choose (DICOM codes, so the rest of the app treats every source alike). */
export const MODALITIES: { code: string; label: string }[] = [
  { code: "PT", label: "PET" },
  { code: "NM", label: "SPECT" },
  { code: "CT", label: "CT" },
  { code: "MR", label: "MRT" },
  { code: "OT", label: "Sonstige" },
];

/** Display name of a modality code. */
export function modalityName(code: string): string {
  return MODALITIES.find((m) => m.code === code)?.label ?? (code === "NIfTI" ? "unbekannt" : code);
}

/**
 * Guesses the modality of a NIfTI file from a BIDS sidecar, the file name, dynamics and the value range.
 * Returns a DICOM modality code or undefined.
 */
export function guessNiftiModality(fileName: string, volume: Volume3D, opts: { dynamic?: boolean; sidecar?: string } = {}): string | undefined {
  if (opts.sidecar) {
    try {
      const j = JSON.parse(opts.sidecar) as Record<string, unknown>;
      const m = typeof j.Modality === "string" ? j.Modality.toUpperCase() : "";
      if (m === "PT" || m === "PET") return "PT";
      if (m === "CT" || m === "MR" || m === "NM") return m;
      if (j.TracerName || j.InjectedRadioactivity) return "PT";
      if (j.MagneticFieldStrength || j.EchoTime) return "MR";
    } catch {
      /* not JSON */
    }
  }
  const name = fileName.toLowerCase().replace(/\.nii(\.gz)?$/, "");
  const has = (re: RegExp) => re.test(name);
  if (has(/(^|[^a-z])(pet|pt|fdg|psma|amyloid|fbb|pib|av45|tau|dopa|fdopa|suv)([^a-z]|$)/)) return "PT";
  if (has(/(^|[^a-z])(spect|nm|datscan|mibg|mibi)([^a-z]|$)/)) return "NM";
  if (has(/(^|[^a-z])(ct|ctac)([^a-z]|$)/)) return "CT";
  if (has(/(^|[^a-z])(t1w?|t2w?|mprage|flair|mri?|anat|dwi|bold)([^a-z]|$)/)) return "MR";
  if (opts.dynamic) return "PT";
  // CT: air (≈ −1000 HU) and bone/soft tissue (> 300 HU) in the same image.
  const d = volume.data;
  const step = Math.max(1, Math.floor(d.length / 50000));
  let air = 0, dense = 0, n = 0;
  for (let i = 0; i < d.length; i += step, n++) {
    if (d[i] < -500) air++;
    else if (d[i] > 300) dense++;
  }
  if (air > 0.01 * n && dense > 0) return "CT";
  return undefined;
}

/** File name without folders and NIfTI/DICOM extensions. */
export function shortName(name: string): string {
  return name.replace(/^.*[\\/]/, "").replace(/\.(nii(\.gz)?|dcm|ima)$/i, "");
}

/** Shortens long names in the middle ("sub-01_ses…_pet"). */
export function middleEllipsis(s: string, max = 28): string {
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) * 0.6);
  return `${s.slice(0, head)}…${s.slice(s.length - (max - 1 - head))}`;
}

/** Label for chips and lists: the modality, or "T1-Vorlage"/"PET-Vorlage" for templates. */
export function datasetModality(d: LoadedDataset): string {
  if (d.template) return `${d.template.kind}-Vorlage`;
  if (d.atlas) return "Labels";
  if (d.kindLabel) return d.kindLabel;
  if (d.derivedFrom) return d.derivedFrom.label ?? modalityLabel(d.derivedFrom.source);
  return modalityLabel(d.source);
}

/** Source that defines units/SUV (the original for datasets derived into a standard space). */
export function unitSource(d: LoadedDataset): VolumeSource {
  return d.derivedFrom?.source ?? d.source;
}

/** True for anatomical modalities that serve as the fusion base (CT, MR). */
export function isAnatomical(source: VolumeSource): boolean {
  const m = modalityLabel(source);
  return m === "CT" || m === "MR";
}

export function suvForSource(source: VolumeSource, opts: { halfLifeSec?: number } = {}): SuvResult | null {
  return source.kind === "dicom" ? computeSuv(source.files[0].dataSet, { ...opts, modality: source.modality }) : null;
}

export function rawUnitLabel(source: VolumeSource): string {
  const m = modalityLabel(source);
  if (m === "CT") return "HU";
  if (source.kind !== "dicom") return "";
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
