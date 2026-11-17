import { type Vec3, type VolumeGeometry, type WorldToVoxel, add, applyWorldToVoxel, scale, voxelToWorld } from "../core/geometry";
import type { VoxelGrid } from "../viewer/types";

export type Interpolation = "nearest" | "linear" | "bspline";

export const INTERPOLATION_LABELS: Record<Interpolation, string> = {
  nearest: "Nächster Nachbar (Masken/Labels)",
  linear: "Trilinear (Standard)",
  bspline: "Kubischer B-Spline (schärfer)",
};

/** Target voxel grid: dimensions and patient geometry. */
export interface TargetGrid {
  nx: number;
  ny: number;
  nz: number;
  geometry: VolumeGeometry;
}

/**
 * New grid over the field of view of `base` (same orientation and center) with a given matrix size
 * and/or voxel size. With only a matrix the voxel size follows from the field of view; with only a
 * voxel size the matrix does.
 */
export function customGrid(base: TargetGrid, opts: { matrix?: Vec3; voxelMm?: Vec3 }): TargetGrid {
  const g = base.geometry;
  const dims: Vec3 = [base.nx, base.ny, base.nz];
  const extent = dims.map((n, a) => n * g.spacing[a]) as Vec3;
  let spacing: Vec3;
  let n: Vec3;
  if (opts.matrix && opts.voxelMm) {
    n = opts.matrix.map((v) => Math.max(1, Math.round(v))) as Vec3;
    spacing = [...opts.voxelMm];
  } else if (opts.matrix) {
    n = opts.matrix.map((v) => Math.max(1, Math.round(v))) as Vec3;
    spacing = extent.map((e, a) => e / n[a]) as Vec3;
  } else if (opts.voxelMm) {
    spacing = [...opts.voxelMm];
    n = extent.map((e, a) => Math.max(1, Math.round(e / spacing[a]))) as Vec3;
  } else {
    return base;
  }
  const center = voxelToWorld(g, (base.nx - 1) / 2, (base.ny - 1) / 2, (base.nz - 1) / 2);
  let origin = center;
  for (let a = 0; a < 3; a++) origin = add(origin, scale(g.axes[a], (-spacing[a] * (n[a] - 1)) / 2));
  return { nx: n[0], ny: n[1], nz: n[2], geometry: { ...g, origin, spacing } };
}

// ─── Cubic B-spline (Unser et al.) ──────────────────────────────────────────

const POLE = Math.sqrt(3) - 2;

/** In-place conversion of samples to cubic B-spline coefficients along one line (mirror boundaries). */
function prefilterLine(c: Float64Array): void {
  const n = c.length;
  if (n < 2) return;
  const z = POLE;
  const gain = (1 - z) * (1 - 1 / z);
  for (let i = 0; i < n; i++) c[i] *= gain;
  // Causal initialization (mirror-symmetric extension, truncated sum).
  const horizon = Math.ceil(Math.log(1e-9) / Math.log(Math.abs(z)));
  if (horizon < n) {
    let zk = z;
    let sum = c[0];
    for (let k = 1; k < horizon; k++) {
      sum += zk * c[k];
      zk *= z;
    }
    c[0] = sum;
  } else {
    // Exact initialization for short lines (full mirror-symmetric sum).
    let zk = z;
    const iz = 1 / z;
    let z2n = Math.pow(z, n - 1);
    let sum = c[0] + z2n * c[n - 1];
    z2n *= z2n * iz;
    for (let k = 1; k <= n - 2; k++) {
      sum += (zk + z2n) * c[k];
      zk *= z;
      z2n *= iz;
    }
    c[0] = sum / (1 - Math.pow(z, 2 * n - 2));
  }
  for (let i = 1; i < n; i++) c[i] += z * c[i - 1];
  c[n - 1] = (z / (z * z - 1)) * (z * c[n - 2] + c[n - 1]);
  for (let i = n - 2; i >= 0; i--) c[i] = z * (c[i + 1] - c[i]);
}

/** B-spline coefficients of a volume (separable prefilter along x, y, z). NaN is treated as 0. */
export function bsplineCoefficients(src: VoxelGrid): Float32Array {
  const { nx, ny, nz } = src;
  const out = new Float32Array(nx * ny * nz);
  for (let i = 0; i < out.length; i++) {
    const v = src.data[i];
    out[i] = v === v ? v : 0;
  }
  const dims = [nx, ny, nz];
  const strides = [1, nx, nx * ny];
  for (let axis = 0; axis < 3; axis++) {
    const n = dims[axis];
    if (n < 2) continue;
    const line = new Float64Array(n);
    const [a1, a2] = [0, 1, 2].filter((a) => a !== axis);
    for (let p = 0; p < dims[a2]; p++)
      for (let q = 0; q < dims[a1]; q++) {
        const base = p * strides[a2] + q * strides[a1];
        for (let i = 0; i < n; i++) line[i] = out[base + i * strides[axis]];
        prefilterLine(line);
        for (let i = 0; i < n; i++) out[base + i * strides[axis]] = line[i];
      }
  }
  return out;
}

function bsplineWeights(t: number, w: Float64Array): void {
  const t2 = t * t;
  const t3 = t2 * t;
  const u = 1 - t;
  w[0] = (u * u * u) / 6;
  w[1] = (4 - 6 * t2 + 3 * t3) / 6;
  w[2] = (1 + 3 * t + 3 * t2 - 3 * t3) / 6;
  w[3] = t3 / 6;
}

function mirror(i: number, n: number): number {
  if (n === 1) return 0;
  const period = 2 * n - 2;
  let k = ((i % period) + period) % period;
  if (k >= n) k = period - k;
  return k;
}

// ─── Resampling ─────────────────────────────────────────────────────────────

/**
 * Resamples `source` onto `target` (each target voxel center is mapped to the source via world
 * coordinates and `w2v`, which may include a registration). Points outside the source become 0.
 */
export function resampleInto(source: VoxelGrid, w2v: WorldToVoxel, target: TargetGrid, method: Interpolation = "linear", onProgress?: (fraction: number) => void): Float32Array {
  const { nx, ny, nz } = target;
  const out = new Float32Array(nx * ny * nz);
  const tg = target.geometry;
  const v000 = applyWorldToVoxel(w2v, voxelToWorld(tg, 0, 0, 0));
  const step = (i: number, j: number, k: number) => {
    const v = applyWorldToVoxel(w2v, voxelToWorld(tg, i, j, k));
    return [v[0] - v000[0], v[1] - v000[1], v[2] - v000[2]];
  };
  const di = step(1, 0, 0);
  const dj = step(0, 1, 0);
  const dk = step(0, 0, 1);
  const sx = source.nx, sy = source.ny, sz = source.nz;
  const slice = sx * sy;
  const data = method === "bspline" ? bsplineCoefficients(source) : source.data;
  const wx = new Float64Array(4), wy = new Float64Array(4), wz = new Float64Array(4);
  const ix = new Int32Array(4), iy = new Int32Array(4), iz = new Int32Array(4);

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      let x = v000[0] + j * dj[0] + k * dk[0];
      let y = v000[1] + j * dj[1] + k * dk[1];
      let z = v000[2] + j * dj[2] + k * dk[2];
      const row = (k * ny + j) * nx;
      for (let i = 0; i < nx; i++, x += di[0], y += di[1], z += di[2]) {
        if (x < -0.5 || y < -0.5 || z < -0.5 || x > sx - 0.5 || y > sy - 0.5 || z > sz - 0.5) continue;
        let v: number;
        if (method === "nearest") {
          const xi = Math.min(sx - 1, Math.max(0, Math.round(x)));
          const yi = Math.min(sy - 1, Math.max(0, Math.round(y)));
          const zi = Math.min(sz - 1, Math.max(0, Math.round(z)));
          v = data[zi * slice + yi * sx + xi];
        } else if (method === "linear") {
          const cx = x < 0 ? 0 : x > sx - 1 ? sx - 1 : x;
          const cy = y < 0 ? 0 : y > sy - 1 ? sy - 1 : y;
          const cz = z < 0 ? 0 : z > sz - 1 ? sz - 1 : z;
          const x0 = Math.floor(cx), y0 = Math.floor(cy), z0 = Math.floor(cz);
          const x1 = x0 < sx - 1 ? x0 + 1 : x0, y1 = y0 < sy - 1 ? y0 + 1 : y0, z1 = z0 < sz - 1 ? z0 + 1 : z0;
          const fx = cx - x0, fy = cy - y0, fz = cz - z0;
          const b00 = z0 * slice + y0 * sx, b01 = z0 * slice + y1 * sx, b10 = z1 * slice + y0 * sx, b11 = z1 * slice + y1 * sx;
          const c00 = data[b00 + x0] + (data[b00 + x1] - data[b00 + x0]) * fx;
          const c01 = data[b01 + x0] + (data[b01 + x1] - data[b01 + x0]) * fx;
          const c10 = data[b10 + x0] + (data[b10 + x1] - data[b10 + x0]) * fx;
          const c11 = data[b11 + x0] + (data[b11 + x1] - data[b11 + x0]) * fx;
          const c0 = c00 + (c01 - c00) * fy;
          const c1 = c10 + (c11 - c10) * fy;
          v = c0 + (c1 - c0) * fz;
        } else {
          const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
          bsplineWeights(x - fx, wx);
          bsplineWeights(y - fy, wy);
          bsplineWeights(z - fz, wz);
          for (let t = 0; t < 4; t++) {
            ix[t] = mirror(fx - 1 + t, sx);
            iy[t] = mirror(fy - 1 + t, sy) * sx;
            iz[t] = mirror(fz - 1 + t, sz) * slice;
          }
          v = 0;
          for (let c = 0; c < 4; c++) {
            let sumY = 0;
            for (let b = 0; b < 4; b++) {
              const base = iz[c] + iy[b];
              sumY += wy[b] * (wx[0] * data[base + ix[0]] + wx[1] * data[base + ix[1]] + wx[2] * data[base + ix[2]] + wx[3] * data[base + ix[3]]);
            }
            v += wz[c] * sumY;
          }
        }
        out[row + i] = v === v ? v : 0;
      }
    }
    onProgress?.((k + 1) / nz);
  }
  return out;
}
