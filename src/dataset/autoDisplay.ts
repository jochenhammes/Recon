import { type VolumeGeometry, voxelToWorld } from "../core/geometry";

/** Axis-aligned world bounding box [min, max]. */
export type Box = [[number, number, number], [number, number, number]];

/** What the display rule needs to know about a dataset. */
export interface DisplayCandidate {
  /** CT or MR (fusion base). */
  anatomical: boolean;
  /** Label image (atlas, segmentation). */
  labels: boolean;
  box: Box;
  /** Voxel grid key (dims + geometry) – label images on the same grid belong together. */
  gridKey: string;
  /** DICOM FrameOfReferenceUID, if known. */
  frameOfReference?: string;
  /** CT: becomes the base by default. */
  ct?: boolean;
}

export type DisplayDecision = "base" | "newBase" | "overlay" | "hidden";

/** Fraction of the smaller box covered by the intersection (0 = disjoint, 1 = one contains the other). */
export function boxOverlap(a: Box, b: Box): number {
  let inter = 1, va = 1, vb = 1;
  for (let k = 0; k < 3; k++) {
    const lo = Math.max(a[0][k], b[0][k]);
    const hi = Math.min(a[1][k], b[1][k]);
    inter *= Math.max(0, hi - lo);
    va *= Math.max(1e-6, a[1][k] - a[0][k]);
    vb *= Math.max(1e-6, b[1][k] - b[0][k]);
  }
  return inter / Math.min(va, vb);
}

/** World bounding box of a voxel grid (voxel centers ± half a voxel, all 8 corners). */
export function gridBox(g: VolumeGeometry, dims: [number, number, number]): Box {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const i of [-0.5, dims[0] - 0.5]) for (const j of [-0.5, dims[1] - 0.5]) for (const k of [-0.5, dims[2] - 0.5]) {
    const p = voxelToWorld(g, i, j, k);
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[a]);
      max[a] = Math.max(max[a], p[a]);
    }
  }
  return [min, max];
}

export function gridKey(g: VolumeGeometry, dims: [number, number, number]): string {
  const r = (v: number) => v.toFixed(2);
  return [...dims, ...g.origin.map(r), ...g.spacing.map(r), ...g.axes.flat().map((v) => v.toFixed(3))].join(",");
}

/** Minimum overlap with the base for automatic display. */
export const MIN_OVERLAP = 0.3;

/**
 * Decides how a newly loaded dataset is displayed, so loading several datasets does not pile everything on top
 * of each other: the first dataset is the base; a CT replaces any non-CT base, an MR a functional base it overlaps; label images are
 * shown on top of a dataset on the same grid; one functional dataset (PET/SPECT) is shown over the base if it covers
 * the same region; everything else is loaded but not displayed.
 */
export function decideDisplay(next: DisplayCandidate, base: DisplayCandidate | null, shown: DisplayCandidate[]): DisplayDecision {
  if (!base) return "base";
  const sameRegion = (a: DisplayCandidate, b: DisplayCandidate) =>
    (a.frameOfReference !== undefined && a.frameOfReference === b.frameOfReference) || boxOverlap(a.box, b.box) >= MIN_OVERLAP;
  if (next.labels) return [base, ...shown].some((s) => s.gridKey === next.gridKey) || boxOverlap(next.box, base.box) >= 0.8 ? "overlay" : "hidden";
  // CT is the default base: a newly loaded CT replaces any non-CT base (PET, SPECT, MR …).
  if (next.ct) return base.ct ? "hidden" : "newBase";
  if (next.anatomical) return !base.anatomical && sameRegion(next, base) ? "newBase" : "hidden";
  const functionalShown = shown.some((s) => !s.anatomical && !s.labels);
  // With a functional base (no CT/MR), the base itself is the functional image.
  if (functionalShown || !base.anatomical) return "hidden";
  return sameRegion(next, base) ? "overlay" : "hidden";
}
