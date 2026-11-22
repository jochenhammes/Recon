import { getLang } from "../i18n/lang";
import { type SuvResult, computeSuv } from "../analysis/suv";
import type { LayerDisplay } from "../viewer/types";
import type { Volume3D } from "../viewer/volume";
import type { LoadedDataset, VolumeSource } from "./types";

import { t, tk } from "../i18n";
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
  { code: "MR", label: tk("MRT") },
  { code: "OT", label: tk("Sonstige") },
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
  if (d.template) return t("{kind}-Vorlage", { kind: d.template.kind });
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
  return source.kind === "dicom" ? computeSuv(source.files[0].dataSet, { ...opts, modality: source.modality, all: source.files.map((f) => f.dataSet) }) : null;
}

export function rawUnitLabel(source: VolumeSource): string {
  const m = modalityLabel(source);
  if (m === "CT") return "HU";
  if (source.kind !== "dicom") return "";
  const units = source.files[0].dataSet.string("x00541001")?.trim();
  return units === "BQML" ? "Bq/ml" : units === "CNTS" ? "Counts" : (units ?? "");
}

/** Series description (if any) for display. */
export function seriesDescription(source: VolumeSource): string | undefined {
  if (source.kind !== "dicom") return undefined;
  return source.files[0].dataSet.string("x0008103e")?.trim() || undefined;
}

/** Acquisition date/time from the DICOM header (local time as written, no time zone). */
export interface AcquisitionTime {
  /** "YYYYMMDD" */
  date: string;
  /** "HHMMSS[.ffffff]", if present. */
  time?: string;
  /** Which header field it comes from. */
  field: "Acquisition" | "Series" | "Content" | "Study";
}

/**
 * Acquisition date and time of a dataset, if the header has them: AcquisitionDateTime or AcquisitionDate/-Time
 * (earliest over the files of a series, e.g. per CT slice), else SeriesDate/-Time, ContentDate/-Time, StudyDate/-Time.
 * Derived datasets (e.g. resampled into a standard space) use their source. NIfTI has no date.
 */
export function acquisitionTime(d: Pick<LoadedDataset, "source" | "derivedFrom">): AcquisitionTime | undefined {
  const src = d.derivedFrom?.source ?? d.source;
  if (src.kind !== "dicom") return undefined;
  const str = (ds: { string: (t: string) => string | undefined }, tag: string) => ds.string(tag)?.trim() || undefined;
  let best: { date: string; time?: string } | undefined;
  for (const f of src.files) {
    const dt = str(f.dataSet, "x0008002a");
    const date = dt?.slice(0, 8) ?? str(f.dataSet, "x00080022");
    const time = dt && dt.length > 8 ? dt.slice(8).replace(/[+-]\d{4}$/, "") : str(f.dataSet, "x00080032");
    if (!date || !/^\d{8}$/.test(date)) continue;
    const key = date + (time ?? "");
    if (!best || key < best.date + (best.time ?? "")) best = { date, time };
  }
  if (best) return { ...best, field: "Acquisition" };
  const ds = src.files[0].dataSet;
  for (const [field, dTag, tTag] of [
    ["Series", "x00080021", "x00080031"],
    ["Content", "x00080023", "x00080033"],
    ["Study", "x00080020", "x00080030"],
  ] as const) {
    const date = str(ds, dTag);
    if (date && /^\d{8}$/.test(date)) return { date, time: str(ds, tTag), field };
  }
  return undefined;
}

/** "21.11.2026, 14:32:05" (or "21.11.26 14:32" with `short`); seconds only when present. */
export function formatAcquisitionTime(a: AcquisitionTime, short = false): string {
  const d = `${a.date.slice(6, 8)}.${a.date.slice(4, 6)}.${short ? a.date.slice(2, 4) : a.date.slice(0, 4)}`;
  const t = a.time?.replace(/:/g, "");
  if (!t || t.length < 4) return d;
  const hm = `${t.slice(0, 2)}:${t.slice(2, 4)}`;
  if (short) return `${d} ${hm}`;
  return `${d}, ${hm}${t.length >= 6 ? `:${t.slice(4, 6)}` : ""}${getLang() === "de" ? " Uhr" : ""}`;
}

/** CT window presets (center/width in HU) as [min, max]. */
export const CT_PRESETS: { label: string; window: [number, number] }[] = [
  { label: tk("Weichteil"), window: [-160, 240] },
  { label: tk("Lunge"), window: [-1350, 150] },
  { label: tk("Knochen"), window: [-450, 1050] },
  { label: tk("Gehirn"), window: [0, 80] },
  { label: tk("Leber"), window: [-25, 175] },
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
