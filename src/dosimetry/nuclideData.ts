import { NUCLIDES, type Nuclide } from "../header/radionuclide";

import { tk } from "../i18n";
/**
 * Mean energy emitted per nuclear transformation for absorbed-dose calculation (ICRP Publication 107,
 * summed values from the MIRDspecs data sets).
 *
 * `electronKeV`: β⁻ mean energy + conversion + Auger electrons (non-penetrating, deposited locally).
 */
export interface NuclideEnergy {
  id: string;
  electronKeV: number;
  /** β⁻ part of `electronKeV` (rounded literature value, for plausibility). */
  betaKeV?: number;
  /** Photons (γ + X); their dose needs a kernel (local deposition ignores them). */
  photonKeV?: number;
  /** Whether the value was checked against a reference table. */
  verified: boolean;
  source: string;
}

export const THERAPY_NUCLIDES = ["Lu-177", "Tb-161", "I-131", "Y-90"] as const;

const ICRP107 = tk("ICRP Publication 107 (Eckerman & Endo 2008), Summen nach MIRDspecs");

export const DEFAULT_ENERGIES: Record<string, NuclideEnergy> = {
  "Lu-177": { id: "Lu-177", electronKeV: 147.92, betaKeV: 133.3, photonKeV: 35.09, verified: true, source: ICRP107 },
  "Tb-161": { id: "Tb-161", electronKeV: 202.48, betaKeV: 154.3, photonKeV: 36.52, verified: true, source: ICRP107 },
  "I-131": { id: "I-131", electronKeV: 191.84, betaKeV: 181.9, photonKeV: 382.75, verified: true, source: ICRP107 },
  "Y-90": { id: "Y-90", electronKeV: 933.1, betaKeV: 932.9, photonKeV: 0, verified: true, source: ICRP107 },
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
