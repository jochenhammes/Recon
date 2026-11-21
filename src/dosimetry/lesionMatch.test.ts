import { describe, expect, it } from "vitest";
import { identityGeometry } from "../core/geometry";
import { Volume3D } from "../viewer/volume";
import { type Centroid, hungarian, labelCentroids, matchLesions } from "./lesionMatch";

const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const c = (x: number, y: number, z: number): Centroid => ({ center: [x, y, z], voxels: 10 });

describe("lesion matching", () => {
  it("hungarian finds the optimal assignment (not greedy)", () => {
    // greedy would take (0,0)=1 then (1,1)=10 → 11; optimum (0,1)+(1,0) = 2+2 = 4
    expect(hungarian([[1, 2], [2, 10]])).toEqual([1, 0]);
    // rectangular: 3 rows, 2 columns
    const r = hungarian([[5, 1], [1, 5], [3, 3]]);
    expect(r.slice(0, 2)).toEqual([1, 0]);
    expect(r[2]).toBe(-1);
  });

  it("pairs shifted lesions, respects the distance limit and unequal counts", () => {
    const ref = new Map([[1, c(0, 0, 0)], [2, c(50, 0, 0)], [3, c(0, 80, 0)]]);
    const other = new Map([[7, c(52, 3, 0)], [9, c(4, -2, 1)], [11, c(200, 0, 0)]]);
    expect(matchLesions(ref, other, 20)).toEqual([
      { refId: 1, otherId: 9, distMm: Math.hypot(4, -2, 1) },
      { refId: 2, otherId: 7, distMm: Math.hypot(2, 3, 0) },
      { refId: 3, otherId: null },
    ]);
  });

  it("centroids in world coordinates including the placement matrix", () => {
    const v = new Volume3D(new Float32Array(4 * 4 * 4), 4, 4, 4, [2, 2, 2], identityGeometry([2, 2, 2]));
    v.data[(1 * 4 + 1) * 4 + 1] = 5;
    v.data[(1 * 4 + 1) * 4 + 2] = 5;
    const shift = [...I4];
    shift[3] = 10; // translation x (row-major)
    const m = labelCentroids({ volume: v, matrix: shift as never });
    expect(m.get(5)!.voxels).toBe(2);
    expect(m.get(5)!.center[0]).toBeCloseTo(3 + 10, 6);
    expect(m.get(5)!.center[1]).toBeCloseTo(2, 6);
  });
});
