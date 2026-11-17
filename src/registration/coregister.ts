import { quickselect } from "../analysis/stats";
import { type Vec3, type VolumeGeometry, voxelToWorld, worldToVoxelTransform } from "../core/geometry";
import {
  IDENTITY_MAT4,
  type Mat4,
  type TransformParams,
  matrixFromParams,
  paramsFromMatrix,
  transformedWorldToVoxel,
} from "../core/transform";
import { gaussianSmooth } from "../edit/filters";
import { resampleVolume } from "../edit/geometryOps";
import { Volume3D } from "../viewer/volume";
import { BINS, type CostName, CorrelationAccumulator, JointHistogram } from "./cost";
import { powell } from "./powell";

/** Plain image description (transferable to a worker). */
export interface CoregImage {
  data: Float32Array;
  /** [nx, ny, nz] */
  dims: Vec3;
  geometry: VolumeGeometry;
}

export interface CoregOptions {
  /** 6 = rigid, 12 = affine (rigid first, then scale and shear). */
  dof: 6 | 12;
  cost: CostName;
  /** Sampling distances in mm, coarse to fine (SPM default [4, 2], FLIRT 8/4/2/1). */
  levels: number[];
  /** Center-of-mass alignment plus rotation grid search on the coarsest level. */
  coarseSearch: boolean;
  /** Initial moving→reference matrix (current alignment). */
  initial: Mat4;
  /** Max. number of sample points per level. */
  maxSamples?: number;
  /** Optional mask on the fixed image grid (> 0.5 = use): only these regions are sampled. */
  fixedMask?: Float32Array;
}

export interface CoregProgress {
  level: number;
  levels: number;
  stage: string;
  iteration: number;
  cost: number;
}

export interface CoregResult {
  matrix: Mat4;
  params: TransformParams;
  center: Vec3;
  cost: CostName;
  /** Cost (lower is better; NMI/MI/NCC are negated) at the finest level before and after. */
  before: number;
  after: number;
  evaluations: number;
}

export const DEFAULT_LEVELS = [8, 4, 2];

// ─── Preprocessing ──────────────────────────────────────────────────────────

/** Robust intensity range (0.1 / 99.9 percentiles over a subsample of finite values). */
function robustRange(data: Float32Array): [number, number] {
  const stride = Math.max(1, Math.floor(data.length / 1_000_000));
  const sample: number[] = [];
  for (let i = 0; i < data.length; i += stride) if (Number.isFinite(data[i])) sample.push(data[i]);
  if (sample.length === 0) return [0, 1];
  const arr = Float32Array.from(sample);
  const lo = quickselect(arr, Math.floor(0.001 * (arr.length - 1)));
  const hi = quickselect(arr, Math.floor(0.999 * (arr.length - 1)));
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

/** Scales intensities to 0..255 (clipped). */
function scaleTo255(img: CoregImage): Volume3D {
  const [lo, hi] = robustRange(img.data);
  const k = 255 / (hi - lo);
  const out = new Float32Array(img.data.length);
  for (let i = 0; i < out.length; i++) {
    const v = img.data[i];
    out[i] = v === v ? Math.min(255, Math.max(0, (v - lo) * k)) : 0;
  }
  const [nx, ny, nz] = img.dims;
  const g = img.geometry;
  return new Volume3D(out, nz, ny, nx, [g.spacing[2], g.spacing[1], g.spacing[0]], g);
}

/** Downsampled (voxels ≥ sep/2) and smoothed copy for one level. */
function levelImage(vol: Volume3D, sep: number): Volume3D {
  const target = vol.geometry.spacing.map((s) => Math.max(s, sep / 2)) as Vec3;
  const down = target.some((t, a) => t > vol.geometry.spacing[a] * 1.05) ? resampleVolume(vol, target) : vol;
  const fwhm = Math.sqrt(Math.max(sep * sep - Math.min(...down.geometry.spacing) ** 2, 0)) * 0.6;
  return fwhm > 0.5 ? down.withData(gaussianSmooth(down, fwhm)) : down;
}

/** Deterministic pseudo-random numbers (mulberry32) for reproducible jitter. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SampleSet {
  /** World coordinates (reference), xyz interleaved. */
  pos: Float64Array;
  /** Fixed intensities 0..255 (float) and their histogram bins. */
  values: Float32Array;
  bins: Uint8Array;
  n: number;
}

function trilinear(vol: Volume3D, x: number, y: number, z: number): number {
  const { nx, ny, nz, data } = vol;
  if (x < 0 || y < 0 || z < 0 || x > nx - 1 || y > ny - 1 || z > nz - 1) return NaN;
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const x1 = x0 < nx - 1 ? x0 + 1 : x0, y1 = y0 < ny - 1 ? y0 + 1 : y0, z1 = z0 < nz - 1 ? z0 + 1 : z0;
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const s = nx * ny;
  const b00 = z0 * s + y0 * nx, b01 = z0 * s + y1 * nx, b10 = z1 * s + y0 * nx, b11 = z1 * s + y1 * nx;
  const c00 = data[b00 + x0] + (data[b00 + x1] - data[b00 + x0]) * fx;
  const c01 = data[b01 + x0] + (data[b01 + x1] - data[b01 + x0]) * fx;
  const c10 = data[b10 + x0] + (data[b10 + x1] - data[b10 + x0]) * fx;
  const c11 = data[b11 + x0] + (data[b11 + x1] - data[b11 + x0]) * fx;
  const c0 = c00 + (c01 - c00) * fy;
  const c1 = c10 + (c11 - c10) * fy;
  return c0 + (c1 - c0) * fz;
}

/** Regular grid of `sep` mm over the fixed image with random jitter (as in SPM spm_coreg). */
function sampleFixed(fixed: Volume3D, sep: number, maxSamples: number, seed: number, mask?: Volume3D): SampleSet {
  const g = fixed.geometry;
  const stride = g.spacing.map((s) => Math.max(1, sep / s)) as Vec3;
  const counts = [fixed.nx, fixed.ny, fixed.nz].map((n, a) => Math.max(1, Math.floor((n - 1) / stride[a]) + 1));
  const total = counts[0] * counts[1] * counts[2];
  const keep = Math.min(1, maxSamples / total);
  const rand = rng(seed);
  const pos: number[] = [];
  const values: number[] = [];
  for (let k = 0; k < counts[2]; k++)
    for (let j = 0; j < counts[1]; j++)
      for (let i = 0; i < counts[0]; i++) {
        if (keep < 1 && rand() > keep) continue;
        const x = Math.min(fixed.nx - 1, Math.max(0, i * stride[0] + (rand() - 0.5) * stride[0]));
        const y = Math.min(fixed.ny - 1, Math.max(0, j * stride[1] + (rand() - 0.5) * stride[1]));
        const z = Math.min(fixed.nz - 1, Math.max(0, k * stride[2] + (rand() - 0.5) * stride[2]));
        const v = trilinear(fixed, x, y, z);
        if (!(v === v)) continue;
        // Thin out empty background so it does not dominate the histogram.
        if (mask && !(trilinear(mask, x, y, z) > 0.5)) continue;
        if (!mask && v < 1 && rand() > 0.25) continue;
        const w = voxelToWorld(g, x, y, z);
        pos.push(w[0], w[1], w[2]);
        values.push(v);
      }
  const n = values.length;
  const bins = new Uint8Array(n);
  for (let i = 0; i < n; i++) bins[i] = Math.min(BINS - 1, Math.max(0, Math.round((values[i] * (BINS - 1)) / 255)));
  return { pos: Float64Array.from(pos), values: Float32Array.from(values), bins, n };
}

// ─── Cost evaluation ────────────────────────────────────────────────────────

/** Minimum fraction of samples that must fall inside the moving image. */
const MIN_OVERLAP = 0.1;

class CostEvaluator {
  private hist = new JointHistogram();
  private corr = new CorrelationAccumulator();
  evaluations = 0;

  private samples: SampleSet;
  private moving: Volume3D;
  private cost: CostName;

  constructor(samples: SampleSet, moving: Volume3D, cost: CostName) {
    this.samples = samples;
    this.moving = moving;
    this.cost = cost;
  }

  /** Cost for matrix M (moving → reference); lower is better. */
  evaluate(M: Mat4): number {
    this.evaluations++;
    const w2v = transformedWorldToVoxel(worldToVoxelTransform(this.moving.geometry), M);
    const { pos, bins, values, n } = this.samples;
    const useHist = this.cost !== "ncc";
    if (useHist) this.hist.reset();
    else this.corr.reset();
    let inside = 0;
    const m = w2v.m;
    const [ox, oy, oz] = w2v.origin;
    for (let s = 0; s < n; s++) {
      const px = pos[3 * s] - ox;
      const py = pos[3 * s + 1] - oy;
      const pz = pos[3 * s + 2] - oz;
      const v = trilinear(this.moving, m[0] * px + m[1] * py + m[2] * pz, m[3] * px + m[4] * py + m[5] * pz, m[6] * px + m[7] * py + m[8] * pz);
      if (!(v === v)) continue;
      inside++;
      if (useHist) this.hist.add(bins[s], v);
      else this.corr.add(values[s], v);
    }
    if (inside < MIN_OVERLAP * n) return 10; // practically no overlap: worse than any real value
    switch (this.cost) {
      case "ncc":
        return -this.corr.ncc();
      case "cr":
        this.hist.smooth();
        return this.hist.correlationRatioCost();
      case "mi":
        this.hist.smooth();
        return -this.hist.mi();
      default:
        this.hist.smooth();
        return -this.hist.nmi();
    }
  }
}

// ─── Optimization ───────────────────────────────────────────────────────────

const RIGID_KEYS: (keyof TransformParams)[] = ["tx", "ty", "tz", "rx", "ry", "rz"];
const AFFINE_KEYS: (keyof TransformParams)[] = [...RIGID_KEYS, "sx", "sy", "sz", "hxy", "hxz", "hyz"];

function stepFor(key: keyof TransformParams, sep: number): number {
  if (key.startsWith("t")) return sep / 2; // mm
  if (key.startsWith("r")) return Math.max(0.5, sep / 4); // degrees
  return 0.01; // scale / shear
}

function optimize(
  evaluator: CostEvaluator,
  start: TransformParams,
  center: Vec3,
  keys: (keyof TransformParams)[],
  sep: number,
  report: (stage: string, iteration: number, cost: number) => void,
  stage: string,
  shouldStop?: () => boolean,
): { params: TransformParams; cost: number } {
  const toParams = (x: number[]): TransformParams => {
    const p = { ...start };
    keys.forEach((k, i) => (p[k] = x[i]));
    return p;
  };
  const steps = keys.map((k) => stepFor(k, sep));
  const dirs = keys.map((_, i) => keys.map((__, j) => (i === j ? steps[i] : 0)));
  const f = (x: number[]) => evaluator.evaluate(matrixFromParams(toParams(x), center));
  const r = powell(f, keys.map((k) => start[k]), dirs, {
    tolerance: 0.02,
    ftol: 1e-6,
    maxIterations: 20,
    onIteration: (it, value) => report(stage, it, value),
    shouldStop,
  });
  return { params: toParams(r.x), cost: r.value };
}

function centerOfMass(vol: Volume3D): Vec3 | null {
  let s = 0;
  const c: Vec3 = [0, 0, 0];
  const { nx, ny, nz, data } = vol;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = data[(k * ny + j) * nx + i];
        if (!(v > 0)) continue;
        s += v;
        c[0] += v * i;
        c[1] += v * j;
        c[2] += v * k;
      }
  return s > 0 ? voxelToWorld(vol.geometry, c[0] / s, c[1] / s, c[2] / s) : null;
}

/**
 * Coregisters `moving` to `fixed` (reference). Returns the moving→reference matrix. The work is
 * synchronous; run it in a worker for large data.
 */
export function coregister(
  fixedImg: CoregImage,
  movingImg: CoregImage,
  opts: CoregOptions,
  onProgress?: (p: CoregProgress) => void,
  shouldStop?: () => boolean,
): CoregResult {
  const fixed = scaleTo255(fixedImg);
  const maskVolume = opts.fixedMask && opts.fixedMask.length === fixed.data.length ? fixed.withData(opts.fixedMask) : undefined;
  const moving = scaleTo255(movingImg);
  const center = voxelToWorld(moving.geometry, (moving.nx - 1) / 2, (moving.ny - 1) / 2, (moving.nz - 1) / 2);
  const levels = opts.levels.length ? opts.levels : DEFAULT_LEVELS;
  const maxSamples = opts.maxSamples ?? 200_000;
  let params = paramsFromMatrix(opts.initial, center) ?? paramsFromMatrix(IDENTITY_MAT4, center)!;
  let evaluations = 0;
  let before = NaN;
  let after = NaN;

  for (let li = 0; li < levels.length; li++) {
    const sep = levels[li];
    const fixedL = levelImage(fixed, sep);
    // The mask follows the fixed image's downsampling (area-weighted, thresholded at 0.5 when sampled).
    const maskL = maskVolume ? (fixedL.geometry === fixed.geometry ? maskVolume : resampleVolume(maskVolume, fixedL.geometry.spacing)) : undefined;
    const movingL = levelImage(moving, sep);
    const samples = sampleFixed(fixedL, sep, maxSamples, 1234 + li, maskL);
    const evaluator = new CostEvaluator(samples, movingL, opts.cost);
    const report = (stage: string, iteration: number, cost: number) => onProgress?.({ level: li + 1, levels: levels.length, stage, iteration, cost });

    if (li === 0 && opts.coarseSearch) params = coarseSearch(evaluator, params, center, fixedL, movingL, sep, report, shouldStop);

    params = optimize(evaluator, params, center, RIGID_KEYS, sep, report, "rigide", shouldStop).params;
    if (opts.dof === 12 && (li > 0 || levels.length === 1)) params = optimize(evaluator, params, center, AFFINE_KEYS, sep, report, "affin", shouldStop).params;

    if (li === levels.length - 1) {
      // Report the improvement on the finest level (same samples for before/after).
      before = evaluator.evaluate(opts.initial);
      after = evaluator.evaluate(matrixFromParams(params, center));
    }
    evaluations += evaluator.evaluations;
    if (shouldStop?.()) break;
  }
  return { matrix: matrixFromParams(params, center), params, center, cost: opts.cost, before, after, evaluations };
}

/** Center-of-mass alignment and a coarse rotation grid (±30°), keeping the best start (FLIRT-like). */
function coarseSearch(
  evaluator: CostEvaluator,
  start: TransformParams,
  center: Vec3,
  fixed: Volume3D,
  moving: Volume3D,
  sep: number,
  report: (stage: string, iteration: number, cost: number) => void,
  shouldStop?: () => boolean,
): TransformParams {
  const candidates: { params: TransformParams; cost: number }[] = [];
  const consider = (p: TransformParams) => candidates.push({ params: p, cost: evaluator.evaluate(matrixFromParams(p, center)) });
  consider(start);
  // Translation that maps the moving center of mass onto the fixed one (rotation about `center`).
  const cf = centerOfMass(fixed);
  const cm = centerOfMass(moving);
  let base = start;
  if (cf && cm) {
    const M = matrixFromParams(start, center);
    const mapped: Vec3 = [
      M[0] * cm[0] + M[1] * cm[1] + M[2] * cm[2] + M[3],
      M[4] * cm[0] + M[5] * cm[1] + M[6] * cm[2] + M[7],
      M[8] * cm[0] + M[9] * cm[1] + M[10] * cm[2] + M[11],
    ];
    base = { ...start, tx: start.tx + cf[0] - mapped[0], ty: start.ty + cf[1] - mapped[1], tz: start.tz + cf[2] - mapped[2] };
    consider(base);
  }
  const angles = [-30, -15, 0, 15, 30];
  for (const rx of angles)
    for (const ry of angles)
      for (const rz of angles) {
        if (shouldStop?.()) break;
        consider({ ...base, rx: base.rx + rx, ry: base.ry + ry, rz: base.rz + rz });
      }
  candidates.sort((a, b) => a.cost - b.cost);
  report("Grobsuche", 0, candidates[0].cost);
  // Refine the three best starting points (translation + rotation) and keep the best.
  let best = candidates[0];
  for (const c of candidates.slice(0, 3)) {
    const r = optimize(evaluator, c.params, center, RIGID_KEYS, sep * 2, report, "Grobsuche", shouldStop);
    if (r.cost < best.cost) best = r;
  }
  return best.params;
}
