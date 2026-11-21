/**
 * Uncertainty of the absorbed dose after the EANM guidance (Gear et al., EJNMMI Physics 2018): independent relative
 * contributions added in quadrature. The dose is D = TIA · E / m with TIA ∝ counts / (CF · RC):
 * - fit of the time-activity curve (covariance of the fit parameters → TIA);
 * - calibration factor CF (systematic for all time points, acts fully on the TIA);
 * - recovery coefficient RC (only if applied to the region);
 * - mass from the segmented volume (m ∝ V).
 * The input values are not prescribed: they come from the local calibration and phantom measurements.
 */

export interface UncertaintyInputs {
  /** Relative standard uncertainty of the calibration factor (%). */
  calibrationPct?: number;
  /** Relative standard uncertainty of the recovery coefficient (%). */
  rcPct?: number;
  /** Relative standard uncertainty of the segmented volume/mass (%). */
  volumePct?: number;
}

export interface UncertaintyPart {
  label: string;
  /** Relative standard uncertainty (fraction). */
  rel: number;
}

export interface DoseUncertainty {
  /** Combined relative standard uncertainty (fraction, k = 1). */
  rel: number;
  /** Absolute (Gy). */
  sdGy: number;
  parts: UncertaintyPart[];
}

export function doseUncertainty(o: { doseGy: number; tia: number; tiaSd?: number; rcApplied: boolean; inputs?: UncertaintyInputs }): DoseUncertainty | undefined {
  if (!Number.isFinite(o.doseGy)) return undefined;
  const parts: UncertaintyPart[] = [];
  if (o.tiaSd !== undefined && o.tia > 0) parts.push({ label: "Kurvenfit", rel: o.tiaSd / o.tia });
  const i = o.inputs ?? {};
  if (i.calibrationPct) parts.push({ label: "Kalibrierung", rel: i.calibrationPct / 100 });
  if (o.rcApplied && i.rcPct) parts.push({ label: "Recovery", rel: i.rcPct / 100 });
  if (i.volumePct) parts.push({ label: "Volumen/Masse", rel: i.volumePct / 100 });
  if (!parts.length) return undefined;
  const rel = Math.sqrt(parts.reduce((s, p) => s + p.rel * p.rel, 0));
  return { rel, sdGy: rel * o.doseGy, parts };
}
