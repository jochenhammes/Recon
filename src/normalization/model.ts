import { type Vec3, applyWorldToVoxel, voxelToWorld, worldToVoxelTransform } from "../core/geometry";
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

/**
 * The normalization on another grid of the same standard space (e.g. estimated on 2 mm, output on 1 mm): the
 * affine part is evaluated exactly on the new grid, the remaining (smooth) displacement is interpolated
 * trilinearly; outside the old grid it is continued with its edge values.
 */
export function resampleField(n: Normalization, grid: TargetGrid): Normalization {
  const inv = invert4(n.affine);
  const old = n.grid;
  const ON = old.nx * old.ny * old.nz;
  // Residual r = field − A⁻¹·x on the old grid.
  const r = new Float32Array(ON * 3);
  let o = 0;
  for (let k = 0; k < old.nz; k++)
    for (let j = 0; j < old.ny; j++)
      for (let i = 0; i < old.nx; i++) {
        const p = applyMat4(inv, voxelToWorld(old.geometry, i, j, k));
        r[o] = n.field[o] - p[0];
        r[o + 1] = n.field[o + 1] - p[1];
        r[o + 2] = n.field[o + 2] - p[2];
        o += 3;
      }
  const w2v = worldToVoxelTransform(old.geometry);
  const { nx, ny, nz } = grid;
  const out = new Float32Array(nx * ny * nz * 3);
  const cl = (v: number, m: number) => (v < 0 ? 0 : v > m ? m : v);
  o = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const w = voxelToWorld(grid.geometry, i, j, k);
        const a = applyMat4(inv, w);
        const v = applyWorldToVoxel(w2v, w);
        const x = cl(v[0], old.nx - 1), y = cl(v[1], old.ny - 1), z = cl(v[2], old.nz - 1);
        const x0 = Math.min(Math.floor(x), old.nx - 2 < 0 ? 0 : old.nx - 2), y0 = Math.min(Math.floor(y), old.ny - 2 < 0 ? 0 : old.ny - 2), z0 = Math.min(Math.floor(z), old.nz - 2 < 0 ? 0 : old.nz - 2);
        const fx = old.nx > 1 ? x - x0 : 0, fy = old.ny > 1 ? y - y0 : 0, fz = old.nz > 1 ? z - z0 : 0;
        const x1 = Math.min(x0 + 1, old.nx - 1), y1 = Math.min(y0 + 1, old.ny - 1), z1 = Math.min(z0 + 1, old.nz - 1);
        const idx = (ii: number, jj: number, kk: number) => 3 * ((kk * old.ny + jj) * old.nx + ii);
        for (let c = 0; c < 3; c++) {
          const c00 = r[idx(x0, y0, z0) + c] * (1 - fx) + r[idx(x1, y0, z0) + c] * fx;
          const c10 = r[idx(x0, y1, z0) + c] * (1 - fx) + r[idx(x1, y1, z0) + c] * fx;
          const c01 = r[idx(x0, y0, z1) + c] * (1 - fx) + r[idx(x1, y0, z1) + c] * fx;
          const c11 = r[idx(x0, y1, z1) + c] * (1 - fx) + r[idx(x1, y1, z1) + c] * fx;
          out[o + c] = a[c] + (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
        }
        o += 3;
      }
  return { ...n, grid, field: out };
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
