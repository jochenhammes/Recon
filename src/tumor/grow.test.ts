import { describe, expect, it } from "vitest";
import { identityGeometry } from "../core/geometry";
import { Volume3D } from "../viewer/volume";
import { growLesion } from "./segment";

const N = 20;
const vol = () => {
  const d = new Float32Array(N * N * N);
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const r = Math.hypot(i - 6, j - 6, k - 6);
        d[(k * N + j) * N + i] = 100 * Math.exp(-(r * r) / 8) + 10 * Math.exp(-(Math.hypot(i - 15, j - 15, k - 15) ** 2) / 4);
      }
  return new Volume3D(d, N, N, N, [2, 2, 2], identityGeometry([2, 2, 2]));
};

describe("manual lesion by region growing", () => {
  it("finds the nearby maximum and grows to the fraction of it", () => {
    const v = vol();
    const r = growLesion(v, [7, 7, 5], { fraction: 0.4 })!;
    expect(r.max).toBeCloseTo(100, 3);
    expect(r.maxIndex).toBe((6 * N + 6) * N + 6);
    // 100·exp(−r²/8) ≥ 40 ⇔ r² ≤ 8·ln 2.5 ≈ 7.33 (voxels within radius ~2.7)
    const inside = r.voxels.every((p) => v.data[p] >= 40);
    expect(inside).toBe(true);
    expect(r.voxels.length).toBeGreaterThan(50);
    expect(r.voxels.length).toBeLessThan(130);
    // A higher boundary gives a smaller lesion; the second blob is not reached.
    expect(growLesion(v, [6, 6, 6], { fraction: 0.7 })!.voxels.length).toBeLessThan(r.voxels.length);
    expect(r.voxels.some((p) => p === (15 * N + 15) * N + 15)).toBe(false);
  });

  it("respects occupied voxels, the radius limit and empty areas", () => {
    const v = vol();
    const occ = new Int32Array(N * N * N);
    occ[(6 * N + 6) * N + 6] = 3;
    const r = growLesion(v, [6, 6, 6], { fraction: 0.4, occupied: occ })!;
    expect(r.voxels.includes((6 * N + 6) * N + 6)).toBe(false);
    expect(growLesion(v, [6, 6, 6], { fraction: 0.05, maxRadiusMm: 4 })!.voxels.length).toBeLessThanOrEqual(33);
    const empty = new Volume3D(new Float32Array(N * N * N), N, N, N, [2, 2, 2], identityGeometry([2, 2, 2]));
    expect(growLesion(empty, [5, 5, 5], { fraction: 0.4 })).toBeNull();
  });
});
