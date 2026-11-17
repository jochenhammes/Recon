import { describe, expect, it } from "vitest";
import { type VolumeGeometry, worldToVoxelTransform } from "../core/geometry";
import { compositeLayers } from "./composite";
import { computeDisplayGrid, planeBasis, samplePlane, valueAt, worldToPlane } from "./planes";
import { Volume3D } from "./volume";

/** 10×10×10 volume, 2 mm voxels, LPS-aligned, origin at (0,0,0); one hot voxel at index (8, 1, 7). */
function phantom(geometry?: Partial<VolumeGeometry>) {
  const data = new Float32Array(1000);
  data[(7 * 10 + 1) * 10 + 8] = 100;
  const g: VolumeGeometry = {
    origin: [0, 0, 0],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    spacing: [2, 2, 2],
    ...geometry,
  };
  return new Volume3D(data, 10, 10, 10, [2, 2, 2], g);
}

function argmax(a: Float32Array): number {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
}

describe("plane sampling", () => {
  const vol = phantom();
  const w2v = worldToVoxelTransform(vol.geometry);
  const grid = computeDisplayGrid([vol]);
  const hot: [number, number, number] = [16, 2, 14]; // world of voxel (8,1,7)

  it("covers the volume bounds with the finest voxel size", () => {
    expect(grid.min).toEqual([-1, -1, -1]);
    expect(grid.max).toEqual([19, 19, 19]);
    expect(grid.pixel).toBe(2);
  });

  it("axial: patient left on image right, anterior (low y) on top", () => {
    const b = planeBasis(grid, "axial", hot[2]);
    const img = samplePlane(vol, w2v, b);
    const i = argmax(img);
    expect([i % b.width, Math.floor(i / b.width)]).toEqual([8, 1]);
    expect(worldToPlane(b, hot)).toEqual([8, 1]);
  });

  it("coronal and sagittal: head on top", () => {
    const c = planeBasis(grid, "coronal", hot[1]);
    const ci = argmax(samplePlane(vol, w2v, c));
    expect([ci % c.width, Math.floor(ci / c.width)]).toEqual([8, 9 - 7]); // z=7 of 0..9 → row 2 from top

    const s = planeBasis(grid, "sagittal", hot[0]);
    const si = argmax(samplePlane(vol, w2v, s));
    expect([si % s.width, Math.floor(si / s.width)]).toEqual([1, 2]); // anterior (y index 1) on the left
  });

  it("is independent of the storage order (reversed slice axis)", () => {
    // Same patient content, slices stored head → feet.
    const data = new Float32Array(1000);
    data[((9 - 7) * 10 + 1) * 10 + 8] = 100;
    const flipped = new Volume3D(data, 10, 10, 10, [2, 2, 2], {
      origin: [0, 0, 18],
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, -1],
      ],
      spacing: [2, 2, 2],
    });
    const c = planeBasis(computeDisplayGrid([flipped]), "coronal", hot[1]);
    const ci = argmax(samplePlane(flipped, worldToVoxelTransform(flipped.geometry), c));
    expect([ci % c.width, Math.floor(ci / c.width)]).toEqual([8, 2]);
    expect(valueAt(flipped, worldToVoxelTransform(flipped.geometry), hot)).toBe(100);
  });

  it("marks points outside the volume as NaN", () => {
    const b = planeBasis({ min: [-11, -1, -1], max: [19, 19, 19], pixel: 2 }, "axial", 0);
    const img = samplePlane(vol, w2v, b);
    expect(img[0]).toBeNaN();
    expect(img[5]).toBe(0);
  });
});

describe("compositeLayers", () => {
  it("draws the base opaque and skips overlay pixels at/below the window minimum", () => {
    const base = Float32Array.from([0, 100]);
    const overlay = Float32Array.from([0, 10]);
    const rgba = compositeLayers(
      [
        { values: base, window: [0, 100], lut: "gray", opacity: 1 },
        { values: overlay, window: [0, 10], lut: "kidney", opacity: 0.5 },
      ],
      2,
    );
    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 255]); // overlay transparent at 0
    expect(Array.from(rgba.slice(4, 8))).toEqual([255, 255, 255, 255]); // white + white hot-LUT top
  });
});
