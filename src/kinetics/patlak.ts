import { type FrameTiming, cumulativeIntegral, frameMid } from "./tac";

/**
 * Reference-tissue Patlak plot (Patlak & Blasberg, J Cereb Blood Flow Metab 1985;5:584–590) for irreversibly
 * trapped tracers: for t ≥ t*,  C(t)/C_ref(t) = Ki_ref · ∫₀ᵗC_ref/C_ref(t) + V.  Slope Ki_ref in 1/min.
 * As calcPatlak.m of the group's MATLAB code, with real frame times.
 */
export interface PatlakFit {
  ki: number;
  intercept: number;
  r2: number;
  /** Patlak plot points used for the fit. */
  x: number[];
  y: number[];
}

export interface PatlakSetup {
  /** Indices of frames with mid time ≥ t*. */
  frames: number[];
  /** x = ∫C_ref / C_ref for these frames. */
  x: Float64Array;
  cref: Float64Array;
  sx: number;
  sxx: number;
}

/** Shared part of all fits: frames after t* and the x axis from the reference TAC. */
export function patlakSetup(cref: ArrayLike<number>, timing: FrameTiming, tStarMin: number): PatlakSetup {
  const integral = cumulativeIntegral(cref, timing);
  const frames: number[] = [];
  for (let i = 0; i < cref.length; i++) if (frameMid(timing, i) >= tStarMin && cref[i] > 0) frames.push(i);
  if (frames.length < 2) throw new Error("Patlak: weniger als zwei Frames nach t* – Startzeit verringern.");
  const x = Float64Array.from(frames, (i) => integral[i] / cref[i]);
  const c = Float64Array.from(frames, (i) => cref[i]);
  let sx = 0, sxx = 0;
  for (const v of x) {
    sx += v;
    sxx += v * v;
  }
  return { frames, x, cref: c, sx, sxx };
}

/** Least-squares fit of one TAC (values per frame) on a prepared setup. */
export function patlakFit(tac: ArrayLike<number>, s: PatlakSetup): PatlakFit {
  const n = s.frames.length;
  const y = s.frames.map((f, k) => tac[f] / s.cref[k]);
  let sy = 0, sxy = 0, syy = 0;
  for (let k = 0; k < n; k++) {
    sy += y[k];
    sxy += s.x[k] * y[k];
    syy += y[k] * y[k];
  }
  const den = n * s.sxx - s.sx * s.sx;
  const ki = den !== 0 ? (n * sxy - s.sx * sy) / den : NaN;
  const intercept = (sy - ki * s.sx) / n;
  const ssTot = syy - (sy * sy) / n;
  let ssRes = 0;
  for (let k = 0; k < n; k++) ssRes += (y[k] - ki * s.x[k] - intercept) ** 2;
  return { ki, intercept, r2: ssTot > 0 ? 1 - ssRes / ssTot : NaN, x: Array.from(s.x), y };
}

/** Voxelwise Ki_ref and intercept (closed-form regression); voxels outside `mask` are 0. */
export function patlakMaps(frames: Float32Array[], s: PatlakSetup, mask?: Uint8Array): { ki: Float32Array; intercept: Float32Array } {
  const nv = frames[0].length;
  const n = s.frames.length;
  const den = n * s.sxx - s.sx * s.sx;
  const ki = new Float32Array(nv);
  const intercept = new Float32Array(nv);
  const inv = Float64Array.from(s.cref, (c) => 1 / c);
  for (let v = 0; v < nv; v++) {
    if (mask && !mask[v]) continue;
    let sy = 0, sxy = 0;
    for (let k = 0; k < n; k++) {
      const y = frames[s.frames[k]][v] * inv[k];
      sy += y;
      sxy += s.x[k] * y;
    }
    const slope = (n * sxy - s.sx * sy) / den;
    ki[v] = slope;
    intercept[v] = (sy - slope * s.sx) / n;
  }
  return { ki, intercept };
}
