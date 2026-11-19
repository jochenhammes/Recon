import type { DataSet } from "dicom-parser";

/** Body-weight SUV conversion for a PET series: SUV = value [Bq/ml] × factor. */
export interface SuvInfo {
  factor: number;
  weightKg: number;
  injectedDoseBq: number;
  /** Dose decay-corrected to the reference time. */
  doseAtReferenceBq: number;
  /** Minutes from injection to the decay-correction reference time. */
  minutesToReference: number;
  halfLifeSeconds: number;
  /** DecayCorrection (0054,1102) of the series. */
  decayCorrection: string;
}

export type SuvResult = { ok: true; info: SuvInfo } | { ok: false; reason: string };

function str(ds: DataSet, tag: string): string | undefined {
  const v = ds.string(tag)?.trim();
  return v ? v : undefined;
}

function num(ds: DataSet, tag: string): number | undefined {
  const v = parseFloat(str(ds, tag) ?? "");
  return Number.isFinite(v) ? v : undefined;
}

/** Parses DA ("YYYYMMDD") + TM ("HHMMSS.ffffff") or a DT into milliseconds (UTC-agnostic). */
export function parseDicomDateTime(date: string | undefined, time: string | undefined): number | undefined {
  if (!date || !/^\d{8}/.test(date) || !time || !/^\d{2}/.test(time)) return undefined;
  const t = time.replace(/:/g, "");
  const hh = +t.slice(0, 2);
  const mm = t.length >= 4 ? +t.slice(2, 4) : 0;
  const ss = t.length >= 6 ? parseFloat(t.slice(4)) : 0;
  const ms = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), hh, mm, 0) + ss * 1000;
  return Number.isFinite(ms) ? ms : undefined;
}

function parseDt(dt: string | undefined): number | undefined {
  if (!dt || dt.length < 10) return undefined;
  return parseDicomDateTime(dt.slice(0, 8), dt.slice(8).replace(/[+-]\d{4}$/, ""));
}

/**
 * Computes the body-weight SUV factor from a PET header (Units BQML, PatientWeight,
 * Radiopharmaceutical Information Sequence). Supports DecayCorrection START (reference = series
 * start) and ADMIN (reference = injection). Assumes a tissue density of 1 g/ml.
 */
export function computeSuv(ds: DataSet, opts: { halfLifeSec?: number } = {}): SuvResult {
  const modality = str(ds, "x00080060");
  if (modality !== "PT") return { ok: false, reason: `Modality ${modality ?? "unbekannt"} (SUV nur für PET).` };
  const units = str(ds, "x00541001");
  if (units !== "BQML") return { ok: false, reason: `Einheit ${units ?? "unbekannt"} statt BQML.` };
  const weightKg = num(ds, "x00101030");
  if (!weightKg || weightKg <= 0) return { ok: false, reason: "Patientengewicht (0010,1030) fehlt." };

  const rp = ds.elements["x00540016"]?.items?.[0]?.dataSet;
  if (!rp) return { ok: false, reason: "Radiopharmaceutical Information Sequence fehlt." };
  const dose = num(rp, "x00181074");
  const halfLife = opts.halfLifeSec ?? num(rp, "x00181075");
  if (!dose || !halfLife) return { ok: false, reason: "Injizierte Dosis oder Halbwertszeit fehlt." };

  const decayCorrection = str(ds, "x00541102") ?? "START";
  let minutesToReference = 0;
  let doseAtReference = dose;
  if (decayCorrection === "START") {
    const injection =
      parseDt(str(rp, "x00181078")) ??
      parseDicomDateTime(str(ds, "x00080021") ?? str(ds, "x00080020"), str(rp, "x00181072"));
    const seriesStart = parseDicomDateTime(str(ds, "x00080021") ?? str(ds, "x00080020"), str(ds, "x00080031"));
    if (injection === undefined || seriesStart === undefined)
      return { ok: false, reason: "Injektions- oder Serienstartzeit fehlt." };
    let dtMs = seriesStart - injection;
    if (dtMs < 0 && dtMs > -24 * 3600e3 && !str(rp, "x00181078")) dtMs += 24 * 3600e3; // injection before midnight
    if (dtMs < 0) return { ok: false, reason: "Serienstart liegt vor der Injektion." };
    minutesToReference = dtMs / 60000;
    doseAtReference = dose * Math.pow(2, -dtMs / 1000 / halfLife);
  } else if (decayCorrection !== "ADMIN") {
    return { ok: false, reason: `Zerfallskorrektur ${decayCorrection} wird nicht unterstützt.` };
  }

  return {
    ok: true,
    info: {
      factor: (weightKg * 1000) / doseAtReference,
      weightKg,
      injectedDoseBq: dose,
      doseAtReferenceBq: doseAtReference,
      minutesToReference,
      halfLifeSeconds: halfLife,
      decayCorrection,
    },
  };
}
