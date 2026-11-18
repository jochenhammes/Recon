import { describe, expect, it } from "vitest";
import { patlakFit, patlakMaps, patlakSetup } from "./patlak";
import { srtmFit, srtmMaps, srtmSetup } from "./srtm";
import { type FrameTiming, cumulativeIntegral, matlabTrapezIntegral } from "./tac";

/** Typical brain protocol: 6×10 s, 3×20 s, 2×30 s, 2×60 s, 2×150 s, 10×300 s (≈ 60 min), times in minutes. */
const durations = [...Array(6).fill(10), ...Array(3).fill(20), 30, 30, 60, 60, 150, 150, ...Array(10).fill(300)].map((s) => s / 60);
const timing: FrameTiming = { start: [], duration: durations };
let acc = 0;
for (const d of durations) {
  timing.start.push(acc);
  acc += d;
}

const DT = 0.001;
const fineTimes = Array.from({ length: Math.ceil(acc / DT) + 1 }, (_, i) => i * DT);
/** Reference TAC (arbitrary units): fast rise, slow washout. */
const crefFine = fineTimes.map((t) => 40 * (Math.exp(-0.08 * t) - Math.exp(-2.5 * t)));
/** Frame averages of a finely sampled curve. */
const frameAvg = (fine: number[]) =>
  timing.start.map((s, i) => {
    const a = Math.round(s / DT), b = Math.round((s + timing.duration[i]) / DT);
    let sum = 0;
    for (let k = a; k < b; k++) sum += fine[k];
    return sum / (b - a);
  });
const cref = frameAvg(crefFine);

/** Exact SRTM target TAC on the fine grid. */
function srtmTarget(r1: number, k2: number, bp: number): number[] {
  const k2a = k2 / (1 + bp);
  const out: number[] = [];
  let conv = 0;
  const decay = Math.exp(-k2a * DT);
  for (let i = 0; i < fineTimes.length; i++) {
    if (i > 0) conv = conv * decay + 0.5 * DT * (crefFine[i - 1] * decay + crefFine[i]);
    out.push(r1 * crefFine[i] + (k2 - r1 * k2a) * conv);
  }
  return out;
}

describe("time-activity curves", () => {
  it("integrates frame averages with real frame times", () => {
    const t: FrameTiming = { start: [0, 1, 3], duration: [1, 2, 4] };
    expect(Array.from(cumulativeIntegral([2, 4, 6], t))).toEqual([1, 2 + 4, 2 + 8 + 12]);
    // Gap between frames: linear between the neighbouring frame values.
    expect(cumulativeIntegral([2, 4], { start: [0, 2], duration: [1, 1] })[1]).toBeCloseTo(2 + 3 + 2, 10);
  });

  it("reproduces the MATLAB integration for equal frame lengths", () => {
    // calculateIntegralsOfActivityInReferenceRegion.m: trapz([0 1 2 …]·L, [0 C1 C2 …])
    expect(Array.from(matlabTrapezIntegral([2, 4, 6], 5))).toEqual([5, 20, 45]);
  });
});

describe("reference Patlak", () => {
  it("recovers Ki_ref and intercept of an irreversible tracer", () => {
    const ki = 0.012, v = 0.8;
    // C(t) = Ki·∫C_ref + V·C_ref
    let integ = 0;
    const targetFine = crefFine.map((c, i) => {
      if (i > 0) integ += 0.5 * DT * (crefFine[i - 1] + c);
      return ki * integ + v * c;
    });
    const s = patlakSetup(cref, timing, 15);
    const fit = patlakFit(frameAvg(targetFine), s);
    expect(fit.ki).toBeCloseTo(ki, 4);
    expect(fit.intercept).toBeCloseTo(v, 2);
    expect(fit.r2).toBeGreaterThan(0.999);
    // Voxelwise maps agree with the regional fit.
    const frames = frameAvg(targetFine).map((x) => Float32Array.from([x, 2 * x, 0]));
    const maps = patlakMaps(frames, s, Uint8Array.from([1, 1, 0]));
    expect(maps.ki[0]).toBeCloseTo(ki, 4);
    expect(maps.ki[1]).toBeCloseTo(2 * ki, 4);
    expect(maps.ki[2]).toBe(0);
  });
});

describe("SRTM (basis functions)", () => {
  it.each([
    [1.0, 0.1, 0.5],
    [1.2, 0.15, 2.0],
    [0.8, 0.08, 4.0],
  ])("recovers R1=%s, k2=%s, BP_ND=%s without noise", (r1, k2, bp) => {
    const s = srtmSetup(cref, timing, { count: 300 });
    const fit = srtmFit(frameAvg(srtmTarget(r1, k2, bp)), s);
    expect(Math.abs(fit.bp - bp) / bp).toBeLessThan(0.02);
    expect(fit.r1).toBeCloseTo(r1, 1);
    expect(fit.r2).toBeGreaterThan(0.999);
  });

  it("is robust to noise (BP_ND bias < 5 % over 200 realisations at 5 % noise)", () => {
    const s = srtmSetup(cref, timing);
    const clean = frameAvg(srtmTarget(1.0, 0.12, 1.5));
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
    const bps: number[] = [];
    for (let r = 0; r < 200; r++) bps.push(srtmFit(clean.map((c) => c * (1 + 0.05 * gauss())), s).bp);
    const mean = bps.reduce((a, b) => a + b, 0) / bps.length;
    expect(Math.abs(mean - 1.5) / 1.5).toBeLessThan(0.05);
  });

  it("voxelwise maps match the regional fit; reference region gives BP_ND ≈ 0", () => {
    const s = srtmSetup(cref, timing);
    const target = frameAvg(srtmTarget(1.1, 0.1, 1.0));
    const frames = target.map((x, i) => Float32Array.from([x, cref[i]]));
    const maps = srtmMaps(frames, s);
    expect(maps.bp[0]).toBeCloseTo(srtmFit(target, s).bp, 5);
    expect(Math.abs(maps.bp[1])).toBeLessThan(0.02);
    expect(maps.r1[1]).toBeCloseTo(1, 2);
  });
});
