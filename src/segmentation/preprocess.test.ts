import { describe, expect, it } from "vitest";
import { worldToVoxelTransform } from "../core/geometry";
import { Volume3D } from "../viewer/volume";
import { accumulateTile, bodyBox, createTopK, extractPatch, gaussianMap, prepareCt, rasGrid, tileStarts, topKLabels } from "./preprocess";

const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]];

describe("CT segmentation preprocessing", () => {
  it("tiles cover the volume with ≥ 50 % overlap, last tile flush", () => {
    expect(tileStarts(100, 128)).toEqual([0]);
    const t = tileStarts(300, 112);
    expect(t[0]).toBe(0);
    expect(t.at(-1)).toBe(300 - 112);
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeLessThanOrEqual(56);
  });

  it("Gaussian map peaks at the patch center and is positive everywhere", () => {
    const g = gaussianMap([8, 8, 8]);
    expect(Math.max(...g)).toBeCloseTo(1, 5);
    expect(Math.min(...g)).toBeGreaterThan(0);
    expect(g[(4 * 8 + 4) * 8 + 4]).toBeGreaterThan(g[0]);
  });

  it("RAS grid: x → patient right, y → anterior, z → superior, covering the CT", () => {
    const ct = new Volume3D(new Float32Array(10 * 20 * 30), 30, 20, 10, [2, 2, 2], { origin: [0, 0, 0], axes, spacing: [2, 2, 2] });
    const g = rasGrid(ct, 3);
    expect(g.geometry.axes).toEqual([[-1, 0, 0], [0, -1, 0], [0, 0, 1]]);
    expect([g.nx, g.ny, g.nz]).toEqual([7, 13, 20]);
    expect(g.geometry.origin[0]).toBeCloseTo(19 - 1.5, 5); // starts at the patient's left edge (max LPS x)
  });

  it("normalizes with clipping and finds the body box", () => {
    const ct = new Volume3D(new Float32Array(4 * 4 * 4).fill(-1000), 4, 4, 4, [3, 3, 3], { origin: [0, 0, 0], axes, spacing: [3, 3, 3] });
    ct.data[(1 * 4 + 2) * 4 + 1] = 5000;
    const grid = { nx: 4, ny: 4, nz: 4, geometry: ct.geometry };
    const meta = { normalization: { clip: [-1004, 1588] as [number, number], mean: -50, std: 500 } } as never;
    const v = prepareCt(ct, worldToVoxelTransform(ct.geometry), grid, meta);
    expect(Math.max(...v)).toBeLessThanOrEqual((1588 + 50) / 500 + 1e-6);
    expect(bodyBox(v, [4, 4, 4], (-500 + 50) / 500, 0)).toBeTruthy();
  });

  it("averages tile probabilities (top-K) weighted by the Gaussian map", () => {
    const dims: [number, number, number] = [6, 1, 1];
    const patch: [number, number, number] = [1, 1, 4];
    const gauss = Float32Array.from([0.2, 1, 1, 0.2]);
    const topk = createTopK(6, 2);
    // Two classes, channel-major logits. Tile A (x 0–3) favours class 1 strongly, tile B (x 2–5) class 0 mildly.
    accumulateTile(Float32Array.from([0, 0, 0, 0, 4, 4, 4, 4]), 2, gauss, [0, 0, 0], patch, dims, topk);
    accumulateTile(Float32Array.from([1, 1, 1, 1, 0, 0, 0, 0]), 2, gauss, [2, 0, 0], patch, dims, topk);
    // Voxel 2: A (w 1, p1 ≈ 0.98) vs B (w 0.2, p0 ≈ 0.73) → 1; voxel 3: A (w 0.2) vs B (w 1) → 0.
    expect([...topKLabels(topk, 6)]).toEqual([1, 1, 1, 0, 0, 0]);
    expect([...extractPatch(Float32Array.from([1, 2, 3]), [3, 1, 1], [-1, 0, 0], [1, 1, 4], 9)]).toEqual([9, 1, 2, 3]);
  });
});
