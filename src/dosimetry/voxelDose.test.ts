import { describe, expect, it } from "vitest";
import type { VolumeGeometry } from "../core/geometry";
import { Volume3D } from "../viewer/volume";
import { localDepositionDose } from "./nuclideData";
import { bedMono } from "./setup";
import { convolve3d, densityMap, doseFromTia, dvh, integrate, labelOverlap, parseKernel, voxelTia } from "./voxelDose";

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const g: VolumeGeometry = { origin: [0, 0, 0], spacing: [4, 4, 4], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
const vol = (v: number) => new Volume3D(new Float32Array(8 * 8 * 8).fill(v), 8, 8, 8, [4, 4, 4], g);

describe("voxel dose", () => {
  it("mono-exponential voxel TIA and local deposition equal the organ formula", async () => {
    const teff = 40;
    const ts = [24, 72];
    const tps = ts.map((t) => ({ spect: { volume: vol(1000 * Math.exp((-Math.LN2 * t) / teff)), matrix: I }, mbqPerCount: 1e-4, tH: t }));
    const ref = tps[0].spect;
    const tia = await voxelTia(ref, tps, { physHalfLifeH: 6.647 * 24, electronKeV: 147.9, method: "mono" });
    // A0 = 1000 counts × 1e-4 MBq / 0.064 ml = 1.5625 MBq/ml
    const expected = (1.5625 * teff) / Math.LN2;
    expect(tia[100]).toBeCloseTo(expected, 3);
    const dose = doseFromTia(tia, densityMap(ref), ref.volume, { electronKeV: 147.9 });
    expect(dose[100]).toBeCloseTo(localDepositionDose(expected, 147.9, 0.001), 6);
  });

  it("kernel convolution: a delta kernel reproduces S × source, an offset kernel shifts it", () => {
    const data = new Float32Array(9 * 9 * 9);
    data[(4 * 9 + 4) * 9 + 4] = 2;
    const delta = parseKernel("0 0 0 5", "delta", 4, "Gy/MBq·s");
    expect(convolve3d(data, [9, 9, 9], delta)[(4 * 9 + 4) * 9 + 4]).toBeCloseTo(10, 6);
    const shifted = parseKernel("0 0 0 0\n1 0 0 3\n-1 0 0 0", "shift", 4, "Gy/MBq·s");
    const out = convolve3d(data, [9, 9, 9], shifted);
    expect(out[(4 * 9 + 4) * 9 + 5]).toBeCloseTo(6, 6);
    expect(out[(4 * 9 + 4) * 9 + 3]).toBeCloseTo(0, 6);
    // Octant table is mirrored.
    const sym = parseKernel("0 0 0 1\n1 0 0 0.5", "oct", 4, "mGy/MBq·s");
    expect(sym.radius).toBe(1);
    expect(sym.values[(1 * 3 + 1) * 3 + 0]).toBeCloseTo(0.0005, 9);
  });

  it("log-linear voxel integration falls back to trapezoids for implausible curves", () => {
    const t = [3.7, 27.7, 103.1, 124.0], l = Math.LN2 / (6.647 * 24);
    // Activity only at late time points with a steep drop: the log-linear fit would extrapolate to ~1e21.
    expect(integrate(t, [0, 0, 10, 0.001], l, "mono")).toBeCloseTo(integrate(t, [0, 0, 10, 0.001], l, "trapezoid"), 9);
    expect(integrate(t, [5, 8, 10, 1e-7], l, "mono")).toBeLessThan(1e4);
    // A regular washout curve keeps the log-linear result: A0/λ.
    const lam = Math.LN2 / 60;
    const a = t.map((x) => 100 * Math.exp(-lam * x));
    expect(integrate(t, a, l, "mono")).toBeCloseTo(100 / lam, 6);
  });

  it("label overlap (Dice) between placed label maps", () => {
    const n = 8;
    const lab = new Float32Array(n * n * n);
    for (let k = 2; k < 6; k++) for (let j = 2; j < 6; j++) for (let i = 2; i < 6; i++) lab[(k * n + j) * n + i] = 1;
    const v = new Volume3D(lab, n, n, n, [4, 4, 4], g);
    expect(labelOverlap({ volume: v, matrix: I }, { volume: v, matrix: I }, [1], 1).get(1)).toBeCloseTo(1, 9);
    // Shift by 2 voxels (8 mm) along x: overlap 2/4 of the extent → Dice 0.5.
    const shifted = [1, 0, 0, 8, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(labelOverlap({ volume: v, matrix: I }, { volume: v, matrix: shifted }, [1], 1).get(1)).toBeCloseTo(0.5, 9);
  });

  it("DVH statistics", () => {
    const v = Float32Array.from({ length: 100 }, (_, i) => i + 1);
    const s = dvh(v)!;
    expect(s.mean).toBeCloseTo(50.5, 6);
    expect(s.d98).toBe(3);
    expect(s.d2).toBe(99);
    expect(s.curve.volumePct[0]).toBe(100);
  });

  it("BED exceeds the dose and tends to it for long repair half-time ratios", () => {
    expect(bedMono(20, 40, 2.6, 2.8)).toBeGreaterThan(20);
    expect(bedMono(20, 40, 2.6, 2.8)).toBeCloseTo(20 + (400 * (Math.LN2 / 40)) / ((Math.LN2 / 2.8 + Math.LN2 / 40) * 2.6), 9);
  });
});
