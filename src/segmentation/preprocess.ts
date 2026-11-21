import { type Vec3, type WorldToVoxel, voxelToWorld } from "../core/geometry";
import { type TargetGrid, resampleInto } from "../resample/resample";
import type { VoxelGrid } from "../viewer/types";

/**
 * nnU-Net style preprocessing and sliding-window bookkeeping for the TotalSegmentator model:
 * the CT is resampled onto an isotropic grid aligned with RAS (array x → patient right, y → anterior,
 * z → superior; the axis order the model was trained with), CT-normalized, cropped to the body and tiled.
 */
export interface ModelMeta {
  name: string;
  source: string;
  license: string;
  parts: string[];
  bytes: number;
  sha256: string;
  /** Patch size in array order (z, y, x). */
  patchSize: [number, number, number];
  spacing: [number, number, number];
  /**
   * CT intensity normalization: nnU-Net z-score with clipping (default) or MONAI's per-image
   * NormalizeIntensity (nonzero voxels) + ScaleIntensity to a range.
   */
  normalization: ZScoreNorm | MonaiNorm;
  labels: Record<string, string>;
  /** Model output format: logits (default) or the top-k classes with probabilities. */
  output?: { kind: "topk"; k: number };
  /** Array order the network expects: "zyx" (nnU-Net, default; x fastest) or "xyz" (MONAI; z fastest). */
  axisOrder?: "zyx" | "xyz";
  /** Sliding-window overlap (fraction of the patch); default 0.2 (step 0.8 as TotalSegmentator "total"). */
  overlap?: number;
}

export interface ZScoreNorm {
  kind?: "zscore";
  clip: [number, number];
  mean: number;
  std: number;
}

export interface MonaiNorm {
  kind: "monai";
  /** Statistics over voxels ≠ 0 only (MONAI NormalizeIntensity nonzero=True). */
  nonzero: boolean;
  /** Final range (MONAI ScaleIntensity minv/maxv). */
  scaleTo: [number, number];
}

/**
 * Normalizes resampled CT values (HU) in place for the model and returns the threshold above which a voxel counts
 * as body (HU −500 in normalized units; used to skip empty images). Non-finite values count as air (−1024 HU).
 */
export function normalizeForModel(v: Float32Array, norm: ZScoreNorm | MonaiNorm): number {
  if (norm.kind === "monai") {
    let s = 0, s2 = 0, n = 0;
    for (let i = 0; i < v.length; i++) {
      if (!Number.isFinite(v[i])) v[i] = -1024;
      if (norm.nonzero && v[i] === 0) continue;
      s += v[i];
      s2 += v[i] * v[i];
      n++;
    }
    const mean = n ? s / n : 0;
    const std = n ? Math.sqrt(Math.max(s2 / n - mean * mean, 0)) || 1 : 1;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < v.length; i++) {
      if (!(norm.nonzero && v[i] === 0)) v[i] = (v[i] - mean) / std;
      if (v[i] < lo) lo = v[i];
      if (v[i] > hi) hi = v[i];
    }
    const [a, b] = norm.scaleTo;
    const k = hi > lo ? (b - a) / (hi - lo) : 0;
    for (let i = 0; i < v.length; i++) v[i] = a + (v[i] - lo) * k;
    return a + ((-500 - mean) / std - lo) * k;
  }
  const [lo, hi] = norm.clip;
  const { mean, std } = norm;
  for (let i = 0; i < v.length; i++) {
    const x = Number.isFinite(v[i]) ? v[i] : lo;
    v[i] = ((x < lo ? lo : x > hi ? hi : x) - mean) / std;
  }
  return (-500 - mean) / std;
}

/** Reorders a patch between "zyx" (x fastest) and "xyz" (z fastest) layout; `dims` = [nx, ny, nz] of the patch. */
export function transposePatch(src: Float32Array, dims: [number, number, number], channels: number, toXyz: boolean): Float32Array {
  const [nx, ny, nz] = dims;
  const n = nx * ny * nz;
  const out = new Float32Array(src.length);
  for (let c = 0; c < channels; c++) {
    const o = c * n;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const zyx = o + (z * ny + y) * nx + x;
          const xyz = o + (x * ny + y) * nz + z;
          if (toXyz) out[xyz] = src[zyx];
          else out[zyx] = src[xyz];
        }
  }
  return out;
}

/** RAS-aligned grid (in LPS coordinates) covering a volume placed by `toWorld` voxel → world. */
export function rasGrid(vol: VoxelGrid, spacingMm: number, toWorld: (i: number, j: number, k: number) => Vec3 = (i, j, k) => voxelToWorld(vol.geometry, i, j, k)): TargetGrid {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const i of [-0.5, vol.nx - 0.5])
    for (const j of [-0.5, vol.ny - 0.5])
      for (const k of [-0.5, vol.nz - 0.5]) {
        const p = toWorld(i, j, k);
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], p[a]);
          hi[a] = Math.max(hi[a], p[a]);
        }
      }
  const n = [0, 1, 2].map((a) => Math.max(1, Math.round((hi[a] - lo[a]) / spacingMm))) as Vec3;
  const s = spacingMm;
  // LPS: x increases to the patient's left, y to posterior → RAS axes are −x and −y.
  return {
    nx: n[0],
    ny: n[1],
    nz: n[2],
    geometry: {
      origin: [hi[0] - s / 2, hi[1] - s / 2, lo[2] + s / 2],
      axes: [
        [-1, 0, 0],
        [0, -1, 0],
        [0, 0, 1],
      ],
      spacing: [s, s, s],
    },
  };
}

/** CT on the model grid, normalized (clip to the training percentiles, z-score). */
export function prepareCt(ct: VoxelGrid, w2v: WorldToVoxel, grid: TargetGrid, meta: ModelMeta): Float32Array {
  const v = resampleInto(ct, w2v, grid, "bspline");
  normalizeForModel(v, meta.normalization);
  return v;
}

/** Index box [min, max) of voxels above `threshold` (normalized units), expanded by `margin`. */
export function bodyBox(data: Float32Array, dims: Vec3, threshold: number, margin: number): { min: Vec3; max: Vec3 } | null {
  const [nx, ny, nz] = dims;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let k = 0, o = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++, o++)
        if (data[o] > threshold) {
          if (i < min[0]) min[0] = i;
          if (j < min[1]) min[1] = j;
          if (k < min[2]) min[2] = k;
          if (i > max[0]) max[0] = i;
          if (j > max[1]) max[1] = j;
          if (k > max[2]) max[2] = k;
        }
  if (!Number.isFinite(min[0])) return null;
  return {
    min: min.map((v) => Math.max(0, v - margin)) as Vec3,
    max: max.map((v, a) => Math.min(dims[a], v + margin + 1)) as Vec3,
  };
}

/** Tile start positions along one axis (step = fraction of the patch, last tile flush with the end). */
export function tileStarts(size: number, patch: number, stepFraction = 0.5): number[] {
  if (size <= patch) return [0];
  const steps = Math.ceil((size - patch) / (patch * stepFraction)) + 1;
  const out: number[] = [];
  for (let s = 0; s < steps; s++) out.push(Math.round((s * (size - patch)) / (steps - 1)));
  return out;
}

/** Gaussian importance map (σ = patch/8 per axis, as nnU-Net), array order (z, y, x), x fastest. */
export function gaussianMap(patch: [number, number, number]): Float32Array {
  const [pz, py, px] = patch;
  const g = (n: number) => Float32Array.from({ length: n }, (_, i) => Math.exp(-0.5 * ((i - (n - 1) / 2) / (n / 8)) ** 2));
  const gz = g(pz), gy = g(py), gx = g(px);
  const out = new Float32Array(pz * py * px);
  let max = 0;
  for (let z = 0, o = 0; z < pz; z++) for (let y = 0; y < py; y++) for (let x = 0; x < px; x++, o++) max = Math.max(max, (out[o] = gz[z] * gy[y] * gx[x]));
  let minPos = Infinity;
  for (let i = 0; i < out.length; i++) {
    out[i] /= max;
    if (out[i] > 0 && out[i] < minPos) minPos = out[i];
  }
  for (let i = 0; i < out.length; i++) if (out[i] === 0) out[i] = minPos;
  return out;
}

/** Extracts a patch (z, y, x order) from the volume at `start`; outside → `pad`. */
export function extractPatch(data: Float32Array, dims: Vec3, start: Vec3, patch: [number, number, number], pad = 0): Float32Array {
  const [nx, ny, nz] = dims;
  const [pz, py, px] = patch;
  const out = new Float32Array(pz * py * px).fill(pad);
  for (let z = 0; z < pz; z++) {
    const k = start[2] + z;
    if (k < 0 || k >= nz) continue;
    for (let y = 0; y < py; y++) {
      const j = start[1] + y;
      if (j < 0 || j >= ny) continue;
      const src = (k * ny + j) * nx;
      const dst = (z * py + y) * px;
      for (let x = 0; x < px; x++) {
        const i = start[0] + x;
        if (i >= 0 && i < nx) out[dst + x] = data[src + i];
      }
    }
  }
  return out;
}

/** Per-voxel accumulator of the K most probable classes (weighted softmax sums across tiles). */
export interface TopKAccumulator {
  k: number;
  cls: Uint8Array;
  acc: Float32Array;
}

export function createTopK(voxels: number, k = 4): TopKAccumulator {
  return { k, cls: new Uint8Array(voxels * k), acc: new Float32Array(voxels * k) };
}

/**
 * Adds one tile like nnU-Net's Gaussian-weighted averaging of softmax probabilities, restricted to the
 * tile's top-K classes per voxel (the classes that can win); memory K·(1 + 4) bytes per voxel.
 */
export function accumulateTile(logits: Float32Array, classes: number, gauss: Float32Array, start: Vec3, patch: [number, number, number], dims: Vec3, topk: TopKAccumulator): void {
  const [nx, ny, nz] = dims;
  const [pz, py, px] = patch;
  const plane = pz * py * px;
  const K = topk.k;
  const bestC = new Int32Array(K);
  const bestL = new Float64Array(K);
  for (let z = 0, o = 0; z < pz; z++) {
    const kk = start[2] + z;
    for (let y = 0; y < py; y++) {
      const j = start[1] + y;
      for (let x = 0; x < px; x++, o++) {
        const i = start[0] + x;
        if (i < 0 || j < 0 || kk < 0 || i >= nx || j >= ny || kk >= nz) continue;
        // Top-K logits and the softmax denominator.
        bestL.fill(-Infinity);
        let mx = -Infinity;
        for (let c = 0; c < classes; c++) {
          const l = logits[c * plane + o];
          if (l > mx) mx = l;
          if (l > bestL[K - 1]) {
            let p = K - 1;
            while (p > 0 && l > bestL[p - 1]) {
              bestL[p] = bestL[p - 1];
              bestC[p] = bestC[p - 1];
              p--;
            }
            bestL[p] = l;
            bestC[p] = c;
          }
        }
        let den = 0;
        for (let c = 0; c < classes; c++) den += Math.exp(logits[c * plane + o] - mx);
        const w = gauss[o] / den;
        const base = ((kk * ny + j) * nx + i) * K;
        for (let t = 0; t < K; t++) {
          const c = bestC[t];
          const p = w * Math.exp(bestL[t] - mx);
          // Add to an existing slot of the same class, else replace the smallest slot if larger.
          let slot = -1, minSlot = 0;
          for (let s = 0; s < K; s++) {
            if (topk.acc[base + s] > 0 && topk.cls[base + s] === c) {
              slot = s;
              break;
            }
            if (topk.acc[base + s] < topk.acc[base + minSlot]) minSlot = s;
          }
          if (slot >= 0) topk.acc[base + slot] += p;
          else if (p > topk.acc[base + minSlot]) {
            topk.acc[base + minSlot] = p;
            topk.cls[base + minSlot] = c;
          }
        }
      }
    }
  }
}

/** Final labels: class with the largest accumulated probability per voxel (0 where nothing was added). */
export function topKLabels(topk: TopKAccumulator, voxels: number): Uint8Array {
  const out = new Uint8Array(voxels);
  const K = topk.k;
  for (let v = 0; v < voxels; v++) {
    let best = 0, c = 0;
    for (let s = 0; s < K; s++)
      if (topk.acc[v * K + s] > best) {
        best = topk.acc[v * K + s];
        c = topk.cls[v * K + s];
      }
    out[v] = c;
  }
  return out;
}

/**
 * Adds one tile from a model that already returns the top-K classes per voxel as
 * [class₁, p₁, class₂, p₂, …] (2·K channels, channel-major); same weighting as `accumulateTile`.
 */
export function accumulateTopKTile(out: Float32Array, kOut: number, gauss: Float32Array, start: Vec3, patch: [number, number, number], dims: Vec3, topk: TopKAccumulator): void {
  const [nx, ny, nz] = dims;
  const [pz, py, px] = patch;
  const plane = pz * py * px;
  const K = topk.k;
  for (let z = 0, o = 0; z < pz; z++) {
    const kk = start[2] + z;
    for (let y = 0; y < py; y++) {
      const j = start[1] + y;
      for (let x = 0; x < px; x++, o++) {
        const i = start[0] + x;
        if (i < 0 || j < 0 || kk < 0 || i >= nx || j >= ny || kk >= nz) continue;
        const w = gauss[o];
        const base = ((kk * ny + j) * nx + i) * K;
        for (let t = 0; t < kOut; t++) {
          const c = out[2 * t * plane + o];
          const p = w * out[(2 * t + 1) * plane + o];
          if (!(c >= 0) || !(p > 0)) continue;
          let slot = -1, minSlot = 0;
          for (let s = 0; s < K; s++) {
            if (topk.acc[base + s] > 0 && topk.cls[base + s] === c) {
              slot = s;
              break;
            }
            if (topk.acc[base + s] < topk.acc[base + minSlot]) minSlot = s;
          }
          if (slot >= 0) topk.acc[base + slot] += p;
          else if (p > topk.acc[base + minSlot]) {
            topk.acc[base + minSlot] = p;
            topk.cls[base + minSlot] = c;
          }
        }
      }
    }
  }
}
