import { NUCLIDES, type Nuclide } from "../header/radionuclide";

/**
 * Energy emitted per decay for absorbed-dose calculation.
 *
 * `electronKeV`: β⁻ mean energy + conversion + Auger electrons (non-penetrating, deposited locally).
 *
 * The defaults are literature values that still have to be checked against ICRP Publication 107: they are
 * editable in the dosimetry panel and marked as unchecked until replaced.
 */
export interface NuclideEnergy {
  id: string;
  electronKeV: number;
  /** Photons (γ + X), informative; their dose needs a kernel (local deposition ignores them). */
  photonKeV?: number;
  /** Whether the value was checked against a reference table. */
  verified: boolean;
  source: string;
}

export const THERAPY_NUCLIDES = ["Lu-177", "Tb-161", "I-131", "Y-90"] as const;

export const DEFAULT_ENERGIES: Record<string, NuclideEnergy> = {
  "Lu-177": { id: "Lu-177", electronKeV: 147.9, verified: false, source: "Literaturwert, gegen ICRP 107 prüfen" },
  "Tb-161": { id: "Tb-161", electronKeV: 202.5, verified: false, source: "Literaturwert, gegen ICRP 107 prüfen" },
  "I-131": { id: "I-131", electronKeV: 191.6, verified: false, source: "Literaturwert, gegen ICRP 107 prüfen" },
  "Y-90": { id: "Y-90", electronKeV: 933.7, verified: false, source: "Literaturwert, gegen ICRP 107 prüfen" },
};

export function nuclideById(id: string | undefined): Nuclide | undefined {
  return NUCLIDES.find((n) => n.id === id);
}

/** Decays per MBq·h. */
export const DECAYS_PER_MBQH = 3.6e9;
/** J per keV. */
export const J_PER_KEV = 1.602176634e-16;

/** Absorbed dose (Gy) from a time-integrated activity (MBq·h) whose energy (keV/decay) is absorbed in mass kg. */
export function localDepositionDose(tiaMBqH: number, energyKeV: number, massKg: number): number {
  return massKg > 0 ? (tiaMBqH * DECAYS_PER_MBQH * energyKeV * J_PER_KEV) / massKg : NaN;
}
