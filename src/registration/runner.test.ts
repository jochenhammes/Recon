import { describe, expect, it } from "vitest";
import { voxelToWorld } from "../core/geometry";
import { Volume3D } from "../viewer/volume";
import { prepareCoregImage } from "./runner";

describe("prepareCoregImage", () => {
  const big = new Volume3D(Float32Array.from({ length: 120 * 100 * 80 }, (_, i) => i % 97), 80, 100, 120, [1, 0.8, 0.8]);

  it("downsamples to half the finest level, keeps the world extent and returns a new array", () => {
    const img = prepareCoregImage(big, [8, 4, 2]);
    expect(img.data).not.toBe(big.data);
    expect(img.geometry.spacing.every((s) => s >= 0.99)).toBe(true);
    // Outer edges stay in place: first voxel corner = original corner.
    const corner = (g: typeof img.geometry) => voxelToWorld(g, -0.5, -0.5, -0.5);
    corner(img.geometry).forEach((v, a) => expect(v).toBeCloseTo(corner(big.geometry)[a], 6));
  });

  it("caps the voxel count for very large volumes", () => {
    const img = prepareCoregImage(big, [2], 100_000);
    expect(img.dims[0] * img.dims[1] * img.dims[2]).toBeLessThanOrEqual(100_000);
  });

  it("copies small volumes unchanged in values", () => {
    const small = new Volume3D(Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]), 2, 2, 2, [4, 4, 4]);
    const img = prepareCoregImage(small, [8, 4]);
    expect(Array.from(img.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(img.data).not.toBe(small.data);
  });
});
