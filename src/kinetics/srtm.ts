import type { FrameTiming } from "./tac";

/**
 * Simplified reference tissue model (Lammertsma & Hume, NeuroImage 1996;4:153–158), solved with the basis function
 * method (Gunn et al., NeuroImage 1997;6:279–287):
 *   C(t) = R1·C_ref(t) + (k2 − R1·k2a)·[C_ref ⊗ e^(−k2a·t)](t),   k2a = k2/(1 + BP_ND).
 * For a grid of k2a values (θ) the model is linear in (R1, b); the θ with the smallest weighted residual wins.
 */
export interface SrtmFit {
  r1: number;
  k2: number;
  k2a: number;
  bp: number;
  r2: number;
  /** Model TAC per frame. */
  fitted: number[];
}

export interface SrtmSetup {
  thetas: Float64Array;
  /** Basis functions (frame averages of C_ref ⊗ e^(−θt)), one row per θ. */
  basis: Float64Array[];
  cref: Float64Array;
  weights: Float64Array;
  /** Per θ: Σw·c², Σw·c·b, Σw·b², determinant. */
  scc: number;
  scb: Float64Array;
  sbb: Float64Array;
  det: Float64Array;
}

export interface SrtmOptions {
  /** θ range (1/min) and number of basis functions. */
  thetaMin?: number;
  thetaMax?: number;
  count?: number;
  /** Weights per frame; default frame durations. */
  weights?: number[];
}

/** Basis functions: C_ref interpolated linearly through the frame mid times (0 at t = 0), convolved exactly. */
export function srtmSetup(cref: ArrayLike<number>, timing: FrameTiming, opts: SrtmOptions = {}): SrtmSetup {
  const n = cref.length;
  const thetaMin = opts.thetaMin ?? 0.0006, thetaMax = opts.thetaMax ?? 0.6, count = opts.count ?? 100;
  const thetas = Float64Array.from({ length: count }, (_, k) => thetaMin * Math.pow(thetaMax / thetaMin, k / (count - 1)));
  const end = timing.start[n - 1] + timing.duration[n - 1];
  // Fine grid: piecewise-linear C_ref through (0,0) and the frame mids.
  const minDur = Math.min(...timing.duration);
  const dt = Math.max(1e-3, Math.min(minDur / 10, 0.05));
  const steps = Math.ceil(end / dt);
  const knotsT = [0, ...timing.start.map((s, i) => s + timing.duration[i] / 2)];
  const knotsC = [0, ...Array.from(cref)];
  const fine = new Float64Array(steps + 1);
  let seg = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s * dt;
    while (seg < knotsT.length - 2 && t > knotsT[seg + 1]) seg++;
    const t0 = knotsT[seg], t1 = knotsT[seg + 1];
    fine[s] = t >= knotsT[knotsT.length - 1] ? knotsC[knotsC.length - 1] : knotsC[seg] + ((knotsC[seg + 1] - knotsC[seg]) * (t - t0)) / (t1 - t0);
  }
  const weights = Float64Array.from(opts.weights ?? timing.duration);
  const c = Float64Array.from(cref);
  let scc = 0;
  for (let i = 0; i < n; i++) scc += weights[i] * c[i] * c[i];
  const basis: Float64Array[] = [];
  const scb = new Float64Array(count), sbb = new Float64Array(count), det = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const th = thetas[k];
    const decay = Math.exp(-th * dt);
    // Recursive convolution with linear interpolation of C within each step (exact for piecewise-linear input).
    const conv = new Float64Array(steps + 1);
    const a = th * dt;
    const w0 = a > 1e-8 ? (1 - (1 + a) * decay) / (th * a) : dt / 2;
    const w1 = a > 1e-8 ? (a - 1 + decay) / (th * a) : dt / 2;
    for (let s = 1; s <= steps; s++) conv[s] = conv[s - 1] * decay + w0 * fine[s - 1] + w1 * fine[s];
    // Frame averages.
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s0 = Math.round(timing.start[i] / dt), s1 = Math.max(s0 + 1, Math.round((timing.start[i] + timing.duration[i]) / dt));
      let sum = 0;
      for (let s = s0; s < s1; s++) sum += 0.5 * (conv[s] + conv[s + 1]);
      b[i] = sum / (s1 - s0);
    }
    basis.push(b);
    let cb = 0, bb = 0;
    for (let i = 0; i < n; i++) {
      cb += weights[i] * c[i] * b[i];
      bb += weights[i] * b[i] * b[i];
    }
    scb[k] = cb;
    sbb[k] = bb;
    det[k] = scc * bb - cb * cb;
  }
  return { thetas, basis, cref: c, weights, scc, scb, sbb, det };
}

/** Best θ and linear coefficients for one TAC. */
function solve(tac: ArrayLike<number>, s: SrtmSetup): { k: number; r1: number; b: number; rss: number; ssTot: number } {
  const n = s.cref.length;
  let syc = 0, syy = 0, sy = 0, sw = 0;
  for (let i = 0; i < n; i++) {
    syc += s.weights[i] * tac[i] * s.cref[i];
    syy += s.weights[i] * tac[i] * tac[i];
    sy += s.weights[i] * tac[i];
    sw += s.weights[i];
  }
  let best = -1, bestRss = Infinity, bestR1 = NaN, bestB = NaN;
  for (let k = 0; k < s.thetas.length; k++) {
    if (!(Math.abs(s.det[k]) > 1e-12)) continue;
    const bk = s.basis[k];
    let syb = 0;
    for (let i = 0; i < n; i++) syb += s.weights[i] * tac[i] * bk[i];
    const r1 = (syc * s.sbb[k] - syb * s.scb[k]) / s.det[k];
    const b = (s.scc * syb - s.scb[k] * syc) / s.det[k];
    const rss = syy - r1 * syc - b * syb;
    if (rss < bestRss) {
      bestRss = rss;
      best = k;
      bestR1 = r1;
      bestB = b;
    }
  }
  return { k: best, r1: bestR1, b: bestB, rss: bestRss, ssTot: syy - (sy * sy) / sw };
}

export function srtmFit(tac: ArrayLike<number>, s: SrtmSetup): SrtmFit {
  const { k, r1, b } = solve(tac, s);
  if (k < 0) return { r1: NaN, k2: NaN, k2a: NaN, bp: NaN, r2: NaN, fitted: [] };
  const k2a = s.thetas[k];
  const k2 = b + r1 * k2a;
  const fitted = Array.from(s.cref, (c, i) => r1 * c + b * s.basis[k][i]);
  let mean = 0, wsum = 0;
  for (let i = 0; i < fitted.length; i++) {
    mean += s.weights[i] * tac[i];
    wsum += s.weights[i];
  }
  mean /= wsum;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < fitted.length; i++) {
    ssRes += s.weights[i] * (tac[i] - fitted[i]) ** 2;
    ssTot += s.weights[i] * (tac[i] - mean) ** 2;
  }
  return { r1, k2, k2a, bp: k2 / k2a - 1, r2: ssTot > 0 ? 1 - ssRes / ssTot : NaN, fitted };
}

/** Voxelwise BP_ND, R1 and k2; voxels outside `mask` are 0. */
export function srtmMaps(
  frames: Float32Array[],
  s: SrtmSetup,
  mask?: Uint8Array,
  onProgress?: (f: number) => void,
): { bp: Float32Array; r1: Float32Array; k2: Float32Array; k2a: Float32Array; r2: Float32Array } {
  const nv = frames[0].length;
  const n = frames.length;
  const bp = new Float32Array(nv), r1 = new Float32Array(nv), k2 = new Float32Array(nv), k2a = new Float32Array(nv), r2 = new Float32Array(nv);
  const tac = new Float64Array(n);
  for (let v = 0; v < nv; v++) {
    if (mask && !mask[v]) continue;
    for (let i = 0; i < n; i++) tac[i] = frames[i][v];
    const f = solve(tac, s);
    if (f.k < 0) continue;
    const th = s.thetas[f.k];
    const kk2 = f.b + f.r1 * th;
    bp[v] = kk2 / th - 1;
    r1[v] = f.r1;
    k2[v] = kk2;
    k2a[v] = th;
    r2[v] = f.ssTot > 0 ? 1 - f.rss / f.ssTot : 0;
    if (onProgress && v % 65536 === 0) onProgress(v / nv);
  }
  return { bp, r1, k2, k2a, r2 };
}
