import type { CameraProfile } from "./calibration";
import type { RegionMeasure } from "./dose";
import type { TacModel } from "./tacFit";
import type { UncertaintyInputs } from "./uncertainty";

/** One SPECT time point of the dosimetry. */
export interface DosTimePoint {
  /** Entry id of the SPECT dataset. */
  spectId: string;
  /** Entry id of the CT of this time point (density, segmentation, registration). */
  ctId?: string;
  /** Hours after injection, if entered manually (else from the header). */
  tHoursManual?: number;
  /** Acquisition duration (s), if entered manually (else from the header). */
  durationSecManual?: number;
  /** The image is already decay corrected (to the acquisition start). */
  decayCorrected?: boolean;
  /** Organ map (CT segmentation) of this time point. */
  organSetId?: string;
  /** Lesion label map of this time point. */
  lesionSetId?: string;
  /** Unit of the functional image chosen by hand (else from the header / the camera profile). */
  unitOverride?: "Counts" | "Bq/ml";
  /** Registered onto the CT of the first time point (reset when its datasets change). */
  registered?: boolean;
}

/** A label dataset used for the regions; `tp` = SPECT id of its time point, or "all" (registered time points). */
export interface DosLabelSet {
  id: string;
  tp: string | "all";
}

export interface DosRegionOptions {
  enabled: boolean;
  model: TacModel | "auto";
  /** Population T_eff (h) for the single-time-point method after Madsen. */
  teffH?: number;
  /** Apply the recovery coefficient of the camera profile. */
  recovery: boolean;
  /** α/β (Gy) and repair half-time (h) for the BED of this region (kidneys: defaults of `bed`). */
  alphaBeta?: number;
  repairH?: number;
}

export interface DosimetrySetup {
  nuclide: string;
  /** Electron energy per decay (keV) entered by the user, per nuclide. */
  energyOverride: Record<string, number>;
  profile?: CameraProfile;
  injection: { timeMs?: number; activityMBq?: number };
  timePoints: DosTimePoint[];
  /** The time points were set once from the automatic grouping (not repeated automatically). */
  timePointsAuto?: boolean;
  labelSets: DosLabelSet[];
  /**
   * Where the label maps of the time points come from: "t1" = organ map and lesions of T1 for all (registered) time
   * points; "perTp" = each time point its own organ map (lesions only if every time point has its own lesion map).
   * Undefined = per time point.
   */
  labelSource?: "t1" | "perTp";
  /** Label datasets the user switched off (not adopted automatically again). */
  labelSetsDismissed?: string[];
  /** Per region name (lower case). */
  regions: Record<string, DosRegionOptions>;
  /** Fingerprint of the label maps and their assignment at the last measurement (to detect later changes). */
  measuredSig?: string;
  /** Measured per time point (SPECT id) and region name. */
  measurements: Record<string, Record<string, RegionMeasure & { name: string }>>;
  /**
   * Lesions across time points: maximum centroid distance (mm) and manual corrections per time point
   * (SPECT id → reference lesion label → lesion label of that time point, or null = no partner).
   */
  lesionLinks?: { maxMm: number; manual: Record<string, Record<string, number | null>> };
  /** Relative uncertainties of calibration, recovery and volume (EANM 2018), entered by the user. */
  uncertainty?: UncertaintyInputs;
  /** Kidney BED parameters. */
  bed: { alphaBeta: number; repairHalfTimeH: number };
  /** Voxel dose map: integration method and the resulting dataset. */
  voxel: { method: "trapezoid" | "mono"; doseId?: string; kernel?: DoseKernel };
}

/** Dose voxel kernel loaded from a table: S values (Gy per MBq·s) on a cubic grid around the source voxel. */
export interface DoseKernel {
  name: string;
  voxelMm: number;
  /** Half width r: values for offsets −r … r in each axis, x fastest. */
  radius: number;
  values: Float32Array;
}

export function emptySetup(nuclide = "Lu-177"): DosimetrySetup {
  return {
    nuclide,
    energyOverride: {},
    injection: {},
    timePoints: [],
    labelSets: [],
    regions: {},
    measurements: {},
    bed: { alphaBeta: 2.6, repairHalfTimeH: 2.8 },
    voxel: { method: "mono" },
  };
}

/** Organs offered by default for therapy dosimetry (other labels can be switched on). */
export const DEFAULT_ORGANS = ["kidney left", "kidney right", "liver", "spleen", "urinary bladder"];

export const regionKey = (name: string) => name.trim().toLowerCase().replace(/_/g, " ");

/**
 * Biologically effective dose for a mono-exponential washout after instantaneous uptake:
 * BED = D + D²·λ / ((μ + λ)·α/β), with λ = ln2/T_eff and μ = ln2/T_rep (repair).
 */
export function bedMono(doseGy: number, teffH: number, alphaBeta: number, repairHalfTimeH: number): number {
  const lam = Math.LN2 / teffH, mu = Math.LN2 / repairHalfTimeH;
  return doseGy + (doseGy * doseGy * lam) / ((mu + lam) * alphaBeta);
}
