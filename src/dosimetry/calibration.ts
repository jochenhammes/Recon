import type { DataSet } from "dicom-parser";

/** Calibration of one camera configuration (camera + collimator + energy window + reconstruction). */
export interface CameraProfile {
  id: string;
  name: string;
  nuclide: string;
  /** Sensitivity in counts per second per MBq (of the reconstructed SPECT, in the image). */
  cpsPerMBq: number;
  collimator?: string;
  window?: string;
  /** Recovery coefficients from a sphere phantom: volume (ml) → RC (0 … 1). */
  recovery?: { volumeMl: number; rc: number }[];
  note?: string;
}

const STORE_KEY = "recon.dosimetry.cameraProfiles";

export function loadProfiles(): CameraProfile[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list = raw ? (JSON.parse(raw) as CameraProfile[]) : [];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.cpsPerMBq === "number") : [];
  } catch {
    return [];
  }
}

export function saveProfiles(list: CameraProfile[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: profiles live in the project file only */
  }
}

export function parseProfiles(text: string): CameraProfile[] {
  const data = JSON.parse(text) as unknown;
  const list = Array.isArray(data) ? data : (data as { profiles?: unknown }).profiles;
  if (!Array.isArray(list)) throw new Error("Keine Kamera-Profile in der Datei.");
  return list.filter((p): p is CameraProfile => !!p && typeof (p as CameraProfile).cpsPerMBq === "number" && typeof (p as CameraProfile).name === "string")
    .map((p, i) => ({ ...p, id: p.id || `cam${Date.now()}_${i}` }));
}

/** Recovery coefficient for a volume (ml): linear in log(volume) between the phantom spheres, 1 above the largest. */
export function recoveryFor(profile: Pick<CameraProfile, "recovery"> | undefined, volumeMl: number): number {
  const rc = [...(profile?.recovery ?? [])].filter((r) => r.volumeMl > 0 && r.rc > 0).sort((a, b) => a.volumeMl - b.volumeMl);
  if (!rc.length || !(volumeMl > 0)) return 1;
  const last = rc[rc.length - 1];
  if (volumeMl >= last.volumeMl) {
    // Above the largest sphere: towards RC = 1 at four times its volume (no correction for large organs).
    if (volumeMl >= 4 * last.volumeMl || last.rc >= 1) return 1;
    return last.rc + (1 - last.rc) * (Math.log(volumeMl / last.volumeMl) / Math.log(4));
  }
  if (volumeMl <= rc[0].volumeMl) return rc[0].rc;
  for (let i = 1; i < rc.length; i++) {
    if (volumeMl > rc[i].volumeMl) continue;
    const a = rc[i - 1], b = rc[i];
    const f = (Math.log(volumeMl) - Math.log(a.volumeMl)) / (Math.log(b.volumeMl) - Math.log(a.volumeMl));
    return a.rc + f * (b.rc - a.rc);
  }
  return 1;
}

/** Timing and scaling information of one SPECT time point. */
export interface TimePointInfo {
  /** Acquisition start (ms since epoch), if known. */
  acquisitionMs?: number;
  /** Total acquisition duration (s) the counts were collected over. */
  durationSec?: number;
  /** "NONE" = values refer to the acquisition (no decay correction); "START"/"ADMIN" = corrected to that time. */
  decayCorrection?: string;
  /** Injection time (ms since epoch) and injected activity (MBq) from the radiopharmaceutical sequence. */
  injectionMs?: number;
  injectedMBq?: number;
  units?: string;
}

/** DICOM date (YYYYMMDD) + time (HHMMSS.frac) → ms since epoch (local time, as written by the scanner). */
export function dicomDateTime(date: string | undefined, time: string | undefined): number | undefined {
  if (!date || !time) return undefined;
  const d = date.trim(), t = time.trim();
  if (!/^\d{8}$/.test(d) || !/^\d{2}/.test(t)) return undefined;
  const hh = Number(t.slice(0, 2)), mm = Number(t.slice(2, 4) || 0), ss = Number(t.slice(4) || 0);
  return new Date(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)), hh, mm, Math.floor(ss), Math.round((ss % 1) * 1000)).getTime();
}

/** Numeric element value (binary US/UL/SS/SL or text IS/DS); undefined if absent. */
function num(ds: DataSet | undefined, tag: string): number | undefined {
  const el = ds?.elements[tag];
  if (!ds || !el || el.length === 0) return undefined;
  let v: number | undefined;
  if (el.vr === "US") v = ds.uint16(tag);
  else if (el.vr === "UL") v = ds.uint32(tag);
  else if (el.vr === "SS") v = ds.int16(tag);
  else if (el.vr === "SL") v = ds.int32(tag);
  else v = Number(ds.string(tag));
  return v !== undefined && Number.isFinite(v) ? v : undefined;
}

/** Reads timing, duration and decay correction of an NM/SPECT header (missing values stay undefined). */
export function timePointFromHeader(ds: DataSet): TimePointInfo {
  const str = (tag: string) => ds.string(tag)?.trim() || undefined;
  const acquisitionMs =
    dicomDateTime(str("x00080022"), str("x00080032")) ?? dicomDateTime(str("x00080021"), str("x00080031")) ?? dicomDateTime(str("x00080023"), str("x00080033"));
  // Duration: projections × time per projection (NM rotation information), else Actual Frame Duration.
  let durationSec: number | undefined;
  const rot = ds.elements["x00540052"]?.items?.[0]?.dataSet;
  const frameMs = num(rot, "x00181242") ?? num(ds, "x00181242");
  const frames = num(rot, "x00540053") ?? num(ds, "x00540053");
  const heads = num(ds, "x00540021") || 1; // detectors acquire simultaneously: counts add up
  if (frameMs && frames && frameMs > 0 && frames > 0) durationSec = (frameMs / 1000) * frames * heads;
  else if (frameMs && frameMs > 0) durationSec = frameMs / 1000;
  const rp = ds.elements["x00540016"]?.items?.[0]?.dataSet;
  const injectionMs =
    dicomDateTime(rp?.string("x00181078")?.slice(0, 8), rp?.string("x00181078")?.slice(8)) ?? dicomDateTime(str("x00080022") ?? str("x00080021"), rp?.string("x00181072")?.trim());
  const dose = Number(rp?.string("x00181074"));
  return {
    acquisitionMs,
    durationSec,
    decayCorrection: str("x00541102"),
    injectionMs,
    injectedMBq: dose > 0 ? (dose > 1e5 ? dose / 1e6 : dose) : undefined,
    units: str("x00541001"),
  };
}

/**
 * Factor counts/voxel → MBq/voxel at the acquisition start: counts / (T · CF), with the decay during the
 * acquisition corrected (λT / (1 − e^{−λT})) unless the image is already decay corrected.
 */
export function countsToMBq(durationSec: number, cpsPerMBq: number, halfLifeSec: number, decayCorrected = false): number {
  if (!(durationSec > 0) || !(cpsPerMBq > 0)) return NaN;
  const lt = (Math.LN2 / halfLifeSec) * durationSec;
  const during = decayCorrected || lt < 1e-9 ? 1 : lt / (1 - Math.exp(-lt));
  return during / (durationSec * cpsPerMBq);
}
