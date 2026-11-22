import { describe, expect, it } from "vitest";
import { majorityLabels, subVoxelOffsets } from "./labelStats";

describe("majority labels", () => {
  it("takes the most frequent label, ties to the first seen, background counts", () => {
    const s = [Float32Array.of(1, 0, 2, 3), Float32Array.of(1, 0, 2, 4), Float32Array.of(2, 5, 0, 4), Float32Array.of(2, 0, 0, 3)];
    expect([...majorityLabels(s)]).toEqual([1, 0, 2, 3]);
  });
  it("offsets are centred in the voxel", () => {
    expect(subVoxelOffsets(1)).toEqual([[0, 0, 0]]);
    const o = subVoxelOffsets(2);
    expect(o.length).toBe(8);
    expect(o[0]).toEqual([-0.25, -0.25, -0.25]);
    expect(o[7]).toEqual([0.25, 0.25, 0.25]);
  });
});
