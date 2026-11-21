import { describe, expect, it } from "vitest";
import { identityGeometry, voxelToWorld } from "../core/geometry";
import { mipPick, orientedMip } from "./mip";
import { Volume3D } from "./volume";

describe("click in the MIP", () => {
  it("finds the hottest voxel behind the clicked pixel at several angles", () => {
    const n = 24;
    const g = { ...identityGeometry([2, 2, 3]), axes: [[-1, 0, 0], [0, -1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]] };
    const v = new Volume3D(new Float32Array(n * n * n), n, n, n, [3, 2, 2], g);
    const hot: [number, number, number] = [7, 15, 5];
    v.data[(hot[2] * n + hot[1]) * n + hot[0]] = 100;
    v.data[(12 * n + 12) * n + 12] = 20;
    const target = voxelToWorld(g, ...hot);
    for (const deg of [0, 37, 90, 200]) {
      const m = orientedMip(v, deg);
      let best = 0;
      for (let i = 1; i < m.data.length; i++) if (m.data[i] > m.data[best]) best = i;
      const p = mipPick(v, deg, best % m.width, Math.floor(best / m.width))!;
      // within one voxel diagonal of the hot voxel
      expect(Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2])).toBeLessThan(3.5);
    }
    expect(mipPick(v, 0, -5, 3)).toBeNull();
  });
});
