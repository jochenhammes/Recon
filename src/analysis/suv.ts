import type { DataSet } from "dicom-parser";

import { t } from "../i18n";
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
  /** Which time the decay correction refers to (START): series time, earliest acquisition time or GE private scan time. */
  referenceTime?: "series" | "acquisition" | "ge-private";
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

/** Earliest acquisition date/time over the given images ((0008,002A), else (0008,0022)/(0008,0032)). */
function earliestAcquisition(all: DataSet[]): number | undefined {
  let min: number | undefined;
  for (const d of all) {
    const t =
      parseDt(str(d, "x0008002a")) ??
      parseDicomDateTime(str(d, "x00080022") ?? str(d, "x00080021") ?? str(d, "x00080020"), str(d, "x00080032"));
    if (t !== undefined && (min === undefined || t < min)) min = t;
  }
  return min;
}

/**
 * Computes the body-weight SUV factor from a PET header (Units BQML, PatientWeight,
 * Radiopharmaceutical Information Sequence). Supports DecayCorrection START and ADMIN (reference = injection).
 * Assumes a tissue density of 1 g/ml.
 *
 * START follows the vendor-neutral QIBA SUV pseudo-code: the reference time is the series date/time unless it lies
 * after the earliest acquisition date/time of the images (a series created or re-processed later); then the GE
 * private scan date/time (0009,100D) if present, else the earliest acquisition date/time. Pass all images of the
 * series in `opts.all` (default: only `ds`).
 */
export function computeSuv(ds: DataSet, opts: { halfLifeSec?: number; modality?: string; all?: DataSet[] } = {}): SuvResult {
  const modality = opts.modality ?? str(ds, "x00080060");
  if (modality !== "PT") return { ok: false, reason: t("Modality {v} (SUV nur für PET).", { v: modality ?? "unbekannt" }) };
  const units = str(ds, "x00541001");
  if (units !== "BQML") return { ok: false, reason: t("Einheit {v} statt BQML.", { v: units ?? "unbekannt" }) };
  const weightKg = num(ds, "x00101030");
  if (!weightKg || weightKg <= 0) return { ok: false, reason: t("Patientengewicht (0010,1030) fehlt.") };

  const rp = ds.elements["x00540016"]?.items?.[0]?.dataSet;
  if (!rp) return { ok: false, reason: t("Radiopharmaceutical Information Sequence fehlt.") };
  const dose = num(rp, "x00181074");
  const halfLife = opts.halfLifeSec ?? num(rp, "x00181075");
  if (!dose || !halfLife) return { ok: false, reason: t("Injizierte Dosis oder Halbwertszeit fehlt.") };

  const decayCorrection = str(ds, "x00541102") ?? "START";
  let minutesToReference = 0;
  let doseAtReference = dose;
  let referenceTime: SuvInfo["referenceTime"];
  if (decayCorrection === "START") {
    const injection =
      parseDt(str(rp, "x00181078")) ??
      parseDicomDateTime(str(ds, "x00080021") ?? str(ds, "x00080020"), str(rp, "x00181072"));
    const series = parseDicomDateTime(str(ds, "x00080021") ?? str(ds, "x00080020"), str(ds, "x00080031"));
    const acquisition = earliestAcquisition(opts.all?.length ? opts.all : [ds]);
    let reference = series;
    referenceTime = "series";
    if (acquisition !== undefined && (series === undefined || series > acquisition)) {
      const ge = parseDt(str(ds, "x0009100d"));
      reference = ge ?? acquisition;
      referenceTime = ge !== undefined ? "ge-private" : "acquisition";
    }
    if (injection === undefined || reference === undefined)
      return { ok: false, reason: t("Injektions- oder Serienstartzeit fehlt.") };
    let dtMs = reference - injection;
    if (dtMs < 0 && dtMs > -24 * 3600e3 && !str(rp, "x00181078")) dtMs += 24 * 3600e3; // injection before midnight
    if (dtMs < 0) return { ok: false, reason: t("Serienstart liegt vor der Injektion.") };
    minutesToReference = dtMs / 60000;
    doseAtReference = dose * Math.pow(2, -dtMs / 1000 / halfLife);
  } else if (decayCorrection !== "ADMIN") {
    return { ok: false, reason: t("Zerfallskorrektur {decayCorrection} wird nicht unterstützt.", { decayCorrection }) };
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
      referenceTime,
    },
  };
}
