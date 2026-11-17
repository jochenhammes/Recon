import { type Vec3, voxelToWorld } from "../core/geometry";
import { type Mat4, applyMat4, invert4 } from "../core/transform";
import type { TargetGrid } from "../resample/resample";
import type { CoregProgress } from "../registration/coregister";
import type { WarpProgress } from "./warp";

/**
 * Spatial normalization of a subject dataset (usually a T1 MRI) to a template.
 *
 * `field` is the pull-back ("inverse") deformation in SPM's y_*.nii sense: for every template voxel the
 * position in the subject's own patient coordinates (LPS, mm), xyz interleaved. For an affine-only
 * normalization it is derived from `affine` (subject → template world).
 */
export interface Normalization {
  subjectId: string;
  templateName: string;
  /** Template voxel grid (the standard space). */
  grid: TargetGrid;
  /** Subject → template world (affine part; identity for imported fields). */
  affine: Mat4;
  field: Float32Array;
  kind: "affine" | "nonlinear" | "imported";
  /** Similarity before/after (for display). */
  cost?: { name: string; before: number; after: number };
  /** Diagnostics of the nonlinear stage. */
  warp?: { foldedFraction: number; maxDisplacementMm: number; costBefore: number; costAfter: number };
}

/** Pull-back field of an affine normalization: subject position = affine⁻¹ · template world. */
export function fieldFromAffine(grid: TargetGrid, affine: Mat4): Float32Array {
  const inv = invert4(affine);
  const { nx, ny, nz } = grid;
  const out = new Float32Array(nx * ny * nz * 3);
  let o = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const p = applyMat4(inv, voxelToWorld(grid.geometry, i, j, k));
        out[o++] = p[0];
        out[o++] = p[1];
        out[o++] = p[2];
      }
  return out;
}

/**
 * Positions (xyz interleaved) in another world for every template voxel: the pull-back field mapped by
 * `subjectToWorld` (e.g. the subject's placement in the reference world). Used to resample any
 * dataset registered to the subject into the template space.
 */
export function pullbackPositions(n: Normalization, subjectToWorld: Mat4): Float32Array {
  const f = n.field;
  const out = new Float32Array(f.length);
  const M = subjectToWorld;
  for (let i = 0; i < f.length; i += 3) {
    const x = f[i], y = f[i + 1], z = f[i + 2];
    out[i] = M[0] * x + M[1] * y + M[2] * z + M[3];
    out[i + 1] = M[4] * x + M[5] * y + M[6] * z + M[7];
    out[i + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
  }
  return out;
}

/** Subject position for a template voxel (nearest grid point of the field). */
export function pullbackAt(n: Normalization, i: number, j: number, k: number): Vec3 {
  const idx = 3 * ((k * n.grid.ny + j) * n.grid.nx + i);
  return [n.field[idx], n.field[idx + 1], n.field[idx + 2]];
}

/** Progress text for the affine stage of a normalization (`share`: fraction of the whole run). */
export function describeCoregProgress(p: CoregProgress, share = 1): { stage: string; detail: string; fraction: number } {
  return { stage: `Affin · Stufe ${p.level}/${p.levels}`, detail: `${p.stage}, Iteration ${p.iteration + 1}`, fraction: share * ((p.level - 1) / p.levels + 0.5 / p.levels) };
}

/** Progress text for the nonlinear stage, mapped to the range [start, 1]. */
export function describeWarpProgress(p: WarpProgress, start = 0.5): { stage: string; detail: string; fraction: number } {
  return { stage: "Nichtlinear", detail: `Iteration ${p.iteration}/${p.iterations}`, fraction: start + (1 - start) * (p.iteration / p.iterations) };
}

/** Regularization presets (relative weight of the bending energy). */
export const REGULARIZATION_WEIGHT = { light: 0.01, medium: 0.1, heavy: 1 } as const;

/** Whether a volume lies exactly on a grid (dimensions and geometry within 1e-3 mm). */
export function sameGrid(g: TargetGrid, v: { nx: number; ny: number; nz: number; geometry: TargetGrid["geometry"] }): boolean {
  if (g.nx !== v.nx || g.ny !== v.ny || g.nz !== v.nz) return false;
  const close = (a: readonly number[], b: readonly number[]) => a.every((x, i) => Math.abs(x - b[i]) < 1e-3);
  return close(g.geometry.origin, v.geometry.origin) && close(g.geometry.spacing, v.geometry.spacing) && g.geometry.axes.every((a, i) => close(a, v.geometry.axes[i]));
}
