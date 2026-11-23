import type { DataSet } from "dicom-parser";
import { parseDicomDateTime } from "../analysis/suv";
import type { VoiMean, VoiName } from "./vois";

import { t, tk } from "../i18n";
/**
 * Linear conversion SUVR → Centiloid for one tracer and pipeline: CL = slope · SUVR + intercept, where
 * SUVR = mean(ctx) / mean(reference VOI) in MNI space.
 */
export interface CentiloidCalibration {
  id: string;
  tracer: "PiB" | "FBB" | "custom";
  label: string;
  reference: VoiName;
  slope: number;
  intercept: number;
  /** Uptake window (minutes p.i.) the calibration was derived for. */
  window: [number, number];
  source: string;
  /**
   * Which normalization the equation applies to: "recon" = this app's automatic pipeline (calibrated against the
   * GAAIN reference data), "standard" = the SPM8 standard method (for data normalized elsewhere).
   */
  pipeline?: "recon" | "standard";
}

/**
 * Centiloid calibration of the app's MRI pipeline (PET → T1 rigid, T1 → MNI152 2009c affine, GAAIN standard VOIs) after
 * Klunk et al. 2015:
 * - PiB, § 2.2.1:
 *   - the app pipeline on the GAAIN Level-1 data (34 YC-0, 45 AD-100);
 *   - its own anchors (mean SUVR YC-0 1.0311, AD-100 2.0675, whole cerebellum) define 0 and 100 CL;
 *   - against the published Level-1 CL (Supplemental Table A): slope 0.995, intercept 0.28 CL, R² 0.992
 *     (criteria 0.98–1.02, ±2 CL, > 0.98).
 * - Florbetaben, § 2.2.3.1 (surrogate tracer), on the GAAIN FBB project (Rowe et al. 2017; n = 35):
 *   - app FBB SUVR = 0.6099 · app PiB SUVR + 0.4085 (R² 0.946);
 *   - PiB-Calc SUVR = (SUVR − b)/m, then CL with the app anchors.
 * Validation: recon-publication, M1. Notes: src/centiloid/README-calibration.md.
 */
export const CALIBRATIONS: CentiloidCalibration[] = [
  {
    id: "fbb-recon",
    tracer: "FBB",
    label: tk("Florbetaben – Recon-Studio-Pipeline (GAAIN-kalibriert)"),
    reference: "WhlCbl",
    // 96.4856 / 0.6099 and −99.4855 − slope · 0.4085
    slope: 158.2,
    intercept: -164.11,
    window: [90, 110],
    source: tk("Klunk 2015 § 2.2.3.1 an GAAIN-FBB-Daten (n = 35): R² 0,946 gegen PiB; Kreuzvalidierung RMSE 5,9 CL"),
    pipeline: "recon",
  },
  {
    id: "pib-recon",
    tracer: "PiB",
    label: tk("[11C]PiB – Recon-Studio-Pipeline (GAAIN-kalibriert)"),
    reference: "WhlCbl",
    // 100 / (2.0675 − 1.0311), −slope · 1.0311
    slope: 96.49,
    intercept: -99.49,
    window: [50, 70],
    source: tk("Klunk 2015 § 2.2.1: eigene Anker an GAAIN-Level-1-Daten (n = 79); gegen Standard-CL Steigung 0,995, R² 0,992"),
    pipeline: "recon",
  },
  {
    id: "fbb-rowe2017",
    tracer: "FBB",
    label: tk("Florbetaben – SPM8-Standard (Rowe et al. 2017)"),
    reference: "WhlCbl",
    slope: 153.4,
    intercept: -154.9,
    window: [90, 110],
    source: tk("Rowe CC et al., Eur J Nucl Med Mol Imaging 2017;44:2053–2059 (SPM8-Standardmethode, ganzes Kleinhirn) – für extern normalisierte Daten"),
    pipeline: "standard",
  },
  {
    id: "pib-klunk2015",
    tracer: "PiB",
    label: tk("[11C]PiB – Standard (Klunk et al. 2015)"),
    reference: "WhlCbl",
    // CL = 100 (SUVR − 1.009) / 1.067
    slope: 100 / 1.067,
    intercept: (-100 * 1.009) / 1.067,
    window: [50, 70],
    source: tk("Klunk WE et al., Alzheimers Dement 2015;11:1–15 (Standardmethode, ganzes Kleinhirn) – für extern normalisierte Daten"),
    pipeline: "standard",
  },
];

export function computeCentiloid(suvr: number, c: Pick<CentiloidCalibration, "slope" | "intercept">): number {
  return c.slope * suvr + c.intercept;
}

export interface CentiloidResult {
  calibration: CentiloidCalibration;
  means: VoiMean[];
  /** SUVR of ctx for every available reference VOI. */
  suvr: Partial<Record<VoiName, number>>;
  centiloid: number;
}

export function centiloidFromMeans(means: VoiMean[], calibration: CentiloidCalibration): CentiloidResult {
  const ctx = means.find((m) => m.name === "ctx")?.mean ?? NaN;
  const suvr: Partial<Record<VoiName, number>> = {};
  for (const m of means) if (m.name !== "ctx") suvr[m.name] = ctx / m.mean;
  return { calibration, means, suvr, centiloid: computeCentiloid(suvr[calibration.reference] ?? NaN, calibration) };
}

// ── Acquisition window from the DICOM header ──

export interface AcquisitionWindow {
  startMin: number;
  endMin: number;
  tracerName?: string;
}

function str(ds: DataSet, tag: string): string | undefined {
  const v = ds.string(tag)?.trim();
  return v ? v : undefined;
}

/**
 * Minutes p.i. covered by a PET series: injection (Radiopharmaceutical Start DateTime/Time) to series or
 * acquisition start plus frame duration × number of time slices. Returns a reason when not determinable.
 */
export function acquisitionWindow(ds: DataSet): AcquisitionWindow | { reason: string } {
  const rp = ds.elements["x00540016"]?.items?.[0]?.dataSet;
  if (!rp) return { reason: t("Radiopharmaceutical Information Sequence fehlt.") };
  const date = str(ds, "x00080021") ?? str(ds, "x00080022") ?? str(ds, "x00080020");
  const dt = str(rp, "x00181078");
  const injection = dt && dt.length >= 10 ? parseDicomDateTime(dt.slice(0, 8), dt.slice(8).replace(/[+-]\d{4}$/, "")) : parseDicomDateTime(date, str(rp, "x00181072"));
  const startTimes = [str(ds, "x00080031"), str(ds, "x00080032")].map((t) => parseDicomDateTime(date, t)).filter((t): t is number => t !== undefined);
  if (injection === undefined || !startTimes.length) return { reason: t("Injektions- oder Aufnahmezeit fehlt.") };
  let start = Math.min(...startTimes) - injection;
  if (start < 0 && start > -24 * 3600e3 && !dt) start += 24 * 3600e3;
  if (start < 0) return { reason: t("Aufnahme liegt vor der Injektion.") };
  const frameMs = parseFloat(str(ds, "x00181242") ?? "");
  const frames = Math.max(1, parseInt(str(ds, "x00540101") ?? "1", 10) || 1);
  const durationMin = Number.isFinite(frameMs) ? (frameMs * frames) / 60000 : 0;
  const tracerName = str(rp, "x00180031") ?? rp.elements["x00540304"]?.items?.[0]?.dataSet?.string("x00080104")?.trim();
  return { startMin: start / 60000, endMin: start / 60000 + durationMin, tracerName };
}

/** Tracer guess from the header's radiopharmaceutical name. */
export function guessTracer(name: string | undefined): CentiloidCalibration["tracer"] | null {
  if (!name) return null;
  if (/florbetaben|neuraceq|fbb|av-?1\b|bay\s*94/i.test(name)) return "FBB";
  if (/pib|pittsburgh/i.test(name)) return "PiB";
  return null;
}

/** Message when the acquisition does not match the calibration window (tolerance in minutes). */
export function windowWarning(w: AcquisitionWindow, calibration: CentiloidCalibration, toleranceMin = 5): string | null {
  const [a, b] = calibration.window;
  const end = w.endMin > w.startMin ? w.endMin : w.startMin;
  if (w.startMin < a - toleranceMin || end > b + toleranceMin)
    return t("Aufnahme {v}–{v2} min p. i., Kalibrierung gilt für {a}–{b} min p. i.", { v: w.startMin.toFixed(0), v2: end.toFixed(0), a, b });
  return null;
}
