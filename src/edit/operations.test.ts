import { describe, expect, it } from "vitest";
import { voxelToWorld } from "../core/geometry";
import { Volume3D } from "../viewer/volume";
import { applyEdit, applyEdits, countAffected, describeEdit } from "./operations";
import { gaussianSmooth } from "./filters";
import { cropVolume, flipVolume, resampleVolume, rotateVolume90 } from "./geometryOps";
import { paintDisc, voiMask, voiStats } from "./voi";

const small = () => new Volume3D(Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]), 2, 2, 2, [1, 2, 3]);

function cube(n: number, spacing = 2, fill: (i: number, j: number, k: number) => number = () => 0): Volume3D {
  const data = new Float32Array(n * n * n);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[(k * n + j) * n + i] = fill(i, j, k);
  return new Volume3D(data, n, n, n, [spacing, spacing, spacing]);
}

describe("value operations", () => {
  it("replaces values >= threshold (inclusive) and leaves the input untouched", () => {
    const vol = small();
    const { volume, affected } = applyEdit(vol, { type: "thresholdReplace", threshold: 5, value: -1 });
    expect(Array.from(volume.data)).toEqual([0, 1, 2, 3, 4, -1, -1, -1]);
    expect(affected).toBe(3);
    expect(Array.from(vol.data)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(volume.voxelSpacingMm).toEqual([1, 2, 3]);
  });

  it("does not count voxels already equal to the target value", () => {
    const op = { type: "thresholdReplace", threshold: 6, value: 7 } as const;
    expect(countAffected(small(), op)).toBe(1);
    expect(applyEdit(small(), op).affected).toBe(1);
  });

  it("supports <=, range, clip and linear rules", () => {
    const run = (rule: Parameters<typeof applyEdit>[1]) => Array.from(applyEdit(small(), rule).volume.data);
    expect(run({ type: "value", rule: { kind: "le", threshold: 2, value: 9 } })).toEqual([9, 9, 9, 3, 4, 5, 6, 7]);
    expect(run({ type: "value", rule: { kind: "range", min: 3, max: 4, value: 0 } })).toEqual([0, 1, 2, 0, 0, 5, 6, 7]);
    expect(run({ type: "value", rule: { kind: "clip", min: 2, max: 5 } })).toEqual([2, 2, 2, 3, 4, 5, 5, 5]);
    expect(run({ type: "value", rule: { kind: "linear", a: 2, b: 1 } })).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
  });

  it("undo by replay reproduces intermediate states", () => {
    const ops = [
      { type: "value", rule: { kind: "linear", a: 2, b: 0 } },
      { type: "thresholdReplace", threshold: 10, value: 10 },
    ] as const;
    expect(Array.from(applyEdits(small(), [...ops]).data)).toEqual([0, 2, 4, 6, 8, 10, 10, 10]);
    expect(Array.from(applyEdits(small(), [ops[0]]).data)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  it("describes edits in display units", () => {
    expect(describeEdit({ type: "thresholdReplace", threshold: 2153.3, value: 2153.3 }, { scale: 1 / 2153.3, label: "SUV" })).toBe(
      "Werte ≥ 1 SUV auf 1 SUV gesetzt",
    );
  });
});

describe("VOI", () => {
  it("rasterizes a sphere with about the analytic volume and computes statistics", () => {
    const vol = cube(40, 2, (i) => i); // value = x index
    const center = voxelToWorld(vol.geometry, 20, 20, 20);
    const mask = voiMask(vol, { kind: "sphere", center, radius: 20 });
    const stats = voiStats(vol, mask);
    expect(stats.volumeMl).toBeGreaterThan(((4 / 3) * Math.PI * 20 ** 3) / 1000 * 0.95);
    expect(stats.volumeMl).toBeLessThan(((4 / 3) * Math.PI * 20 ** 3) / 1000 * 1.05);
    expect(stats.mean).toBeCloseTo(20, 5);
    expect(stats.max).toBe(30);
    expect(stats.min).toBe(10);
    // Peak: mean of the 1-ml sphere around the hottest voxel (x = 30); like SUVpeak it may extend
    // beyond the VOI, and for a linear ramp its mean equals the center value.
    expect(stats.peak).toBeCloseTo(30, 5);
  });

  it("sets values inside or outside a box", () => {
    const vol = cube(10, 1, () => 1);
    const center = voxelToWorld(vol.geometry, 4.5, 4.5, 4.5);
    const voi = { kind: "box" as const, center, size: [4, 4, 4] as [number, number, number] };
    const inside = applyEdit(vol, { type: "voi", voi, region: "inside", action: { kind: "set", value: 0 } });
    expect(inside.affected).toBe(64);
    const outside = applyEdit(vol, { type: "voi", voi, region: "outside", action: { kind: "scale", factor: 3 } });
    expect(outside.affected).toBe(1000 - 64);
  });

  it("paints a one-slice-thick disc", () => {
    const vol = cube(20, 1);
    const mask = new Uint8Array(vol.data.length);
    paintDisc(vol, mask, voxelToWorld(vol.geometry, 10, 10, 5), 3, 2, 1);
    let n = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) {
      n++;
      expect(Math.floor(i / 400)).toBe(5);
    }
    expect(n).toBe(29); // lattice points within radius 3
  });
});

describe("filters and geometry", () => {
  it("Gaussian smoothing preserves the sum of an interior point source", () => {
    const vol = cube(21, 2, (i, j, k) => (i === 10 && j === 10 && k === 10 ? 1000 : 0));
    const out = gaussianSmooth(vol, 6);
    const sum = out.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1000, 1);
    expect(out[(10 * 21 + 10) * 21 + 10]).toBeLessThan(1000);
    expect(out[(10 * 21 + 10) * 21 + 11]).toBeGreaterThan(0);
  });

  it("crop keeps anatomy in place", () => {
    const vol = cube(10, 2, (i, j, k) => i + 10 * j + 100 * k);
    const c = cropVolume(vol, [2, 3, 4], [5, 6, 8]);
    expect([c.nx, c.ny, c.nz]).toEqual([4, 4, 5]);
    expect(c.data[0]).toBe(2 + 30 + 400);
    expect(voxelToWorld(c.geometry, 0, 0, 0)).toEqual(voxelToWorld(vol.geometry, 2, 3, 4));
  });

  it("flip mirrors content, rotate90 rotates clockwise about the center", () => {
    const vol = new Volume3D(Float32Array.from([1, 2, 3, 4, 5, 6]), 1, 2, 3, [1, 1, 1]); // 3 wide, 2 high
    expect(Array.from(flipVolume(vol, 0).data)).toEqual([3, 2, 1, 6, 5, 4]);
    const r = rotateVolume90(vol, 1);
    expect([r.nx, r.ny]).toEqual([2, 3]);
    // Clockwise: left column (1,4) becomes the top row read right→left (4,1).
    expect(Array.from(r.data)).toEqual([4, 1, 5, 2, 6, 3]);
    const c0 = voxelToWorld(vol.geometry, 1, 0.5, 0);
    const c1 = voxelToWorld(r.geometry, 0.5, 1, 0);
    c1.forEach((v, i) => expect(v).toBeCloseTo(c0[i], 9));
    expect(Array.from(rotateVolume90(vol, 4).data)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("resampling keeps the extent and the mean when downsampling", () => {
    const vol = cube(12, 2, (i) => i);
    const r = resampleVolume(vol, [4, 4, 4]);
    expect([r.nx, r.ny, r.nz]).toEqual([6, 6, 6]);
    expect(r.data[0]).toBeCloseTo(0.5, 6); // mean of x = 0 and 1
    const mean = (v: Volume3D) => v.data.reduce((a, b) => a + b, 0) / v.data.length;
    expect(mean(r)).toBeCloseTo(mean(vol), 6);
    // Outer edge stays: first new voxel center is 1 mm further in than the old one.
    expect(r.geometry.origin[0]).toBeCloseTo(vol.geometry.origin[0] + 1, 9);
    const up = resampleVolume(vol, [1, 1, 1]);
    expect(up.nx).toBe(24);
  });
});
