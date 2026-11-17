import { describe, expect, it } from "vitest";
import { Volume3D } from "../viewer/volume";
import { applyEdit, countAffected } from "./operations";

describe("thresholdReplace", () => {
  const make = () => new Volume3D(Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]), 2, 2, 2, [1, 2, 3]);

  it("replaces values >= threshold (inclusive) and leaves the input untouched", () => {
    const vol = make();
    const { volume, affected } = applyEdit(vol, { type: "thresholdReplace", threshold: 5, value: -1 });
    expect(Array.from(volume.data)).toEqual([0, 1, 2, 3, 4, -1, -1, -1]);
    expect(affected).toBe(3);
    expect(Array.from(vol.data)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(volume.voxelSpacingMm).toEqual([1, 2, 3]);
    expect([volume.nz, volume.ny, volume.nx]).toEqual([2, 2, 2]);
  });

  it("does not count voxels already equal to the target value", () => {
    const op = { type: "thresholdReplace", threshold: 6, value: 7 } as const;
    expect(countAffected(make(), op)).toBe(1);
    expect(applyEdit(make(), op).affected).toBe(1);
  });
});
