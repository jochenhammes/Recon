import { type Vec3, applyWorldToVoxel, voxelToWorld, worldToVoxelTransform } from "../core/geometry";
import type { Volume3D } from "../viewer/volume";

/**
 * Volume of interest in the volume's own patient coordinates (mm). Sphere/box are analytic; a mask
 * VOI (e.g. painted with the brush) stores one byte per voxel of the volume it was drawn on.
 */
export type VoiShape =
  | { kind: "sphere"; center: Vec3; radius: number }
  | { kind: "box"; center: Vec3; size: Vec3 }
  | { kind: "mask"; mask: Uint8Array; dims: Vec3 };

/** Rasterizes a VOI on the volume grid: 1 = inside. */
export function voiMask(volume: Volume3D, shape: VoiShape): Uint8Array {
  const { nx, ny, nz } = volume;
  if (shape.kind === "mask") {
    if (shape.dims[0] !== nx || shape.dims[1] !== ny || shape.dims[2] !== nz)
      throw new Error("VOI-Maske passt nicht zur Volumengröße.");
    return shape.mask;
  }
  const mask = new Uint8Array(nx * ny * nz);
  const g = volume.geometry;
  const extent: Vec3 = shape.kind === "sphere" ? [shape.radius, shape.radius, shape.radius] : [shape.size[0] / 2, shape.size[1] / 2, shape.size[2] / 2];
  // Index-space bounding box from the 8 corners of the world-space bounding box.
  const t = worldToVoxelTransform(g);
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const v = applyWorldToVoxel(t, [shape.center[0] + sx * extent[0], shape.center[1] + sy * extent[1], shape.center[2] + sz * extent[2]]);
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], v[a]);
          hi[a] = Math.max(hi[a], v[a]);
        }
      }
  const dims = [nx, ny, nz];
  const i0 = lo.map((v) => Math.max(0, Math.floor(v))) as Vec3;
  const i1 = hi.map((v, a) => Math.min(dims[a] - 1, Math.ceil(v))) as Vec3;
  for (let k = i0[2]; k <= i1[2]; k++)
    for (let j = i0[1]; j <= i1[1]; j++)
      for (let i = i0[0]; i <= i1[0]; i++) {
        const w = voxelToWorld(g, i, j, k);
        const d: Vec3 = [w[0] - shape.center[0], w[1] - shape.center[1], w[2] - shape.center[2]];
        const inside =
          shape.kind === "sphere"
            ? d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= shape.radius * shape.radius
            : Math.abs(d[0]) <= extent[0] && Math.abs(d[1]) <= extent[1] && Math.abs(d[2]) <= extent[2];
        if (inside) mask[(k * ny + j) * nx + i] = 1;
      }
  return mask;
}

/**
 * Paints (value 1) or erases (0) a disc of `radius` mm in the plane perpendicular to world axis
 * `normalAxis` through `center` (volume's own world coordinates), one slice thick.
 */
export function paintDisc(volume: Volume3D, mask: Uint8Array, center: Vec3, radius: number, normalAxis: 0 | 1 | 2, value: 0 | 1): { min: Vec3; max: Vec3 } {
  const { nx, ny, nz } = volume;
  const g = volume.geometry;
  const t = worldToVoxelTransform(g);
  const c = applyWorldToVoxel(t, center);
  // Slab half-thickness along the normal: half the voxel size of the axis closest to it.
  let halfThickness = 0.5;
  for (let a = 0; a < 3; a++) if (Math.abs(g.axes[a][normalAxis]) > 0.7) halfThickness = g.spacing[a] / 2;
  const reach = [radius / g.spacing[0], radius / g.spacing[1], radius / g.spacing[2]].map((r) => Math.ceil(r) + 1);
  const lo: Vec3 = [Math.max(0, Math.floor(c[0] - reach[0])), Math.max(0, Math.floor(c[1] - reach[1])), Math.max(0, Math.floor(c[2] - reach[2]))];
  const hi: Vec3 = [Math.min(nx - 1, Math.ceil(c[0] + reach[0])), Math.min(ny - 1, Math.ceil(c[1] + reach[1])), Math.min(nz - 1, Math.ceil(c[2] + reach[2]))];
  for (let k = lo[2]; k <= hi[2]; k++)
    for (let j = lo[1]; j <= hi[1]; j++)
      for (let i = lo[0]; i <= hi[0]; i++) {
        const w = voxelToWorld(g, i, j, k);
        if (Math.abs(w[normalAxis] - center[normalAxis]) > halfThickness + 1e-6) continue;
        let r2 = 0;
        for (let a = 0; a < 3; a++) if (a !== normalAxis) r2 += (w[a] - center[a]) ** 2;
        if (r2 <= radius * radius) mask[(k * ny + j) * nx + i] = value;
      }
  return { min: lo, max: hi };
}

export interface VoiStats {
  voxels: number;
  volumeMl: number;
  min: number;
  max: number;
  mean: number;
  /** Mean of the 1-ml sphere (r ≈ 6.2 mm) around the hottest voxels inside the VOI (raw units). */
  peak: number;
}

export const PEAK_RADIUS_MM = Math.cbrt((3 * 1000) / (4 * Math.PI)); // 1 ml sphere

/** Statistics of the voxels inside a mask; `bounds` (index box) limits the scan if known. */
export function voiStats(volume: Volume3D, mask: Uint8Array, bounds?: { min: Vec3; max: Vec3 } | null): VoiStats {
  const { data, nx, ny } = volume;
  const [sx, sy, sz] = volume.geometry.spacing;
  const b = bounds ?? { min: [0, 0, 0], max: [nx - 1, ny - 1, volume.nz - 1] };
  let n = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  const candidates: { i: number; v: number }[] = [];
  for (let k = Math.max(0, b.min[2]); k <= Math.min(volume.nz - 1, b.max[2]); k++)
    for (let j = Math.max(0, b.min[1]); j <= Math.min(ny - 1, b.max[1]); j++)
      for (let ii = Math.max(0, b.min[0]); ii <= Math.min(nx - 1, b.max[0]); ii++) {
        const i = (k * ny + j) * nx + ii;
        if (!mask[i]) continue;
        const v = data[i];
        if (!Number.isFinite(v)) continue;
        n++;
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
        candidates.push({ i, v });
      }
  if (n === 0) return { voxels: 0, volumeMl: 0, min: NaN, max: NaN, mean: NaN, peak: NaN };
  // Peak: evaluate the 1-ml sphere mean around the hottest voxels (top 64).
  candidates.sort((a, b) => b.v - a.v);
  let peak = -Infinity;
  for (const c of candidates.slice(0, 64)) peak = Math.max(peak, sphereMean(volume, c.i, PEAK_RADIUS_MM));
  return { voxels: n, volumeMl: (n * sx * sy * sz) / 1000, min, max, mean: sum / n, peak };
}

/** Mean inside a sphere (mm) around a voxel index. */
export function sphereMean(volume: Volume3D, index: number, radiusMm: number): number {
  const { nx, ny, nz, data } = volume;
  const [sx, sy, sz] = volume.geometry.spacing;
  const ci = index % nx;
  const cj = Math.floor(index / nx) % ny;
  const ck = Math.floor(index / (nx * ny));
  const ri = Math.floor(radiusMm / sx);
  const rj = Math.floor(radiusMm / sy);
  const rk = Math.floor(radiusMm / sz);
  let s = 0;
  let c = 0;
  for (let k = Math.max(0, ck - rk); k <= Math.min(nz - 1, ck + rk); k++)
    for (let j = Math.max(0, cj - rj); j <= Math.min(ny - 1, cj + rj); j++)
      for (let i = Math.max(0, ci - ri); i <= Math.min(nx - 1, ci + ri); i++) {
        const d2 = ((i - ci) * sx) ** 2 + ((j - cj) * sy) ** 2 + ((k - ck) * sz) ** 2;
        if (d2 > radiusMm * radiusMm) continue;
        const v = data[(k * ny + j) * nx + i];
        if (Number.isFinite(v)) {
          s += v;
          c++;
        }
      }
  return c > 0 ? s / c : NaN;
}

/** Index-space bounding box [min, max] (inclusive) of a mask, or null if empty. */
export function maskBounds(mask: Uint8Array, nx: number, ny: number): { min: Vec3; max: Vec3 } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let idx = 0; idx < mask.length; idx++) {
    if (!mask[idx]) continue;
    const i = idx % nx;
    const j = Math.floor(idx / nx) % ny;
    const k = Math.floor(idx / (nx * ny));
    if (i < min[0]) min[0] = i;
    if (j < min[1]) min[1] = j;
    if (k < min[2]) min[2] = k;
    if (i > max[0]) max[0] = i;
    if (j > max[1]) max[1] = j;
    if (k > max[2]) max[2] = k;
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}
