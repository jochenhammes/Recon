/**
 * Time–activity curves of dynamic PET. Frame values are frame averages (decay corrected); times in minutes.
 *
 * Unlike the group's MATLAB code (github.com/ghaefner/kinetic-modeling), which integrates with the trapezoidal rule
 * over frame indices × a constant frame length, the real frame start times and durations are used here, so
 * protocols with short early and long late frames are integrated correctly.
 */
export interface FrameTiming {
  /** Frame start times, minutes after injection (or series start). */
  start: number[];
  /** Frame durations, minutes. */
  duration: number[];
}

export const frameMid = (t: FrameTiming, i: number) => t.start[i] + t.duration[i] / 2;
export const frameMids = (t: FrameTiming) => t.start.map((_, i) => frameMid(t, i));

/**
 * ∫₀^{t_mid,i} C(t) dt for every frame (piecewise-constant frame averages; gaps between frames are interpolated
 * linearly, the time before the first frame as a ramp from 0).
 */
export function cumulativeIntegral(values: ArrayLike<number>, t: FrameTiming): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  let acc = 0;
  let prevEnd = 0;
  let prevVal = 0;
  for (let i = 0; i < n; i++) {
    const gap = t.start[i] - prevEnd;
    if (gap > 0) acc += (gap * (prevVal + values[i])) / 2;
    out[i] = acc + (values[i] * t.duration[i]) / 2;
    acc += values[i] * t.duration[i];
    prevEnd = t.start[i] + t.duration[i];
    prevVal = values[i];
  }
  return out;
}

/** Mean TAC of the voxels where `mask(i)` is true; frames: one array per frame (same grid). */
export function regionTac(frames: Float32Array[], mask: (i: number) => boolean): Float64Array {
  const tac = new Float64Array(frames.length);
  const n = frames[0]?.length ?? 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!mask(i)) continue;
    count++;
    for (let f = 0; f < frames.length; f++) tac[f] += frames[f][i];
  }
  if (count) for (let f = 0; f < tac.length; f++) tac[f] /= count;
  return tac;
}

/**
 * Integral as in the MATLAB reference code (calculateIntegralsOfActivityInReferenceRegion.m): trapezoidal rule over
 * the points (0, 0), (1·L, C₁), (2·L, C₂), … with constant frame length L. Kept for the cross-check test.
 */
export function matlabTrapezIntegral(values: ArrayLike<number>, frameLength: number): Float64Array {
  const out = new Float64Array(values.length);
  let acc = 0;
  let prev = 0;
  for (let i = 0; i < values.length; i++) {
    acc += (frameLength * (prev + values[i])) / 2;
    out[i] = acc;
    prev = values[i];
  }
  return out;
}
