import type { DataSet } from "dicom-parser";
import { parseDicomDateTime } from "../analysis/suv";
import type { VoiMean, VoiName } from "./vois";

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
}

export const CALIBRATIONS: CentiloidCalibration[] = [
  {
    id: "fbb-rowe2017",
    tracer: "FBB",
    label: "Florbetaben (Rowe et al. 2017)",
    reference: "WhlCbl",
    slope: 153.4,
    intercept: -154.9,
    window: [90, 110],
    source: "Rowe CC et al., Eur J Nucl Med Mol Imaging 2017;44:2053–2059 (SPM8-Standardmethode, ganzes Kleinhirn)",
  },
  {
    id: "pib-klunk2015",
    tracer: "PiB",
    label: "[11C]PiB (Klunk et al. 2015)",
    reference: "WhlCbl",
    // CL = 100 (SUVR − 1.009) / 1.067
    slope: 100 / 1.067,
    intercept: (-100 * 1.009) / 1.067,
    window: [50, 70],
    source: "Klunk WE et al., Alzheimers Dement 2015;11:1–15 (Standardmethode, ganzes Kleinhirn)",
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
  if (!rp) return { reason: "Radiopharmaceutical Information Sequence fehlt." };
  const date = str(ds, "x00080021") ?? str(ds, "x00080022") ?? str(ds, "x00080020");
  const dt = str(rp, "x00181078");
  const injection = dt && dt.length >= 10 ? parseDicomDateTime(dt.slice(0, 8), dt.slice(8).replace(/[+-]\d{4}$/, "")) : parseDicomDateTime(date, str(rp, "x00181072"));
  const startTimes = [str(ds, "x00080031"), str(ds, "x00080032")].map((t) => parseDicomDateTime(date, t)).filter((t): t is number => t !== undefined);
  if (injection === undefined || !startTimes.length) return { reason: "Injektions- oder Aufnahmezeit fehlt." };
  let start = Math.min(...startTimes) - injection;
  if (start < 0 && start > -24 * 3600e3 && !dt) start += 24 * 3600e3;
  if (start < 0) return { reason: "Aufnahme liegt vor der Injektion." };
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
    return `Aufnahme ${w.startMin.toFixed(0)}–${end.toFixed(0)} min p. i., Kalibrierung gilt für ${a}–${b} min p. i.`;
  return null;
}
