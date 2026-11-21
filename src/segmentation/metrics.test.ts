import { describe, expect, it } from "vitest";
import { canonicalGroup, canonicalName, labelsByCanonical } from "./labelMap";
import { compareLabelMaps, dice, distanceMap, surfaceMetrics } from "./metrics";
import { normalizeForModel, transposePatch } from "./preprocess";

const cube = (n: number, lo: number, hi: number) => {
  const m = new Uint8Array(n * n * n);
  for (let z = lo; z < hi; z++) for (let y = lo; y < hi; y++) for (let x = lo; x < hi; x++) m[(z * n + y) * n + x] = 1;
  return m;
};

describe("label harmonization", () => {
  it("maps names of different models to canonical names", () => {
    expect(canonicalName("kidney left")).toBe("kidney_left");
    expect(canonicalName("heart_ventricle_left")).toBe("heart");
    expect(canonicalName("Right Kidney")).toBe("kidney_right");
    expect(canonicalName("postcava")).toBe("inferior_vena_cava");
    expect(canonicalGroup("lung_upper_lobe_left")).toBe("lung");
    const m = labelsByCanonical({ "44": "heart_myocardium", "45": "heart_atrium_left", "5": "liver" });
    expect([...m.get("heart")!]).toEqual([44, 45]);
  });
});

describe("segmentation metrics", () => {
  it("dice and surface metrics of shifted cubes", () => {
    const a = cube(20, 5, 15), b = cube(20, 6, 16);
    // overlap 9³ of 10³ each
    expect(dice(a, b)).toBeCloseTo((2 * 729) / 2000, 6);
    expect(dice(a, a)).toBe(1);
    const s = surfaceMetrics(a, b, [20, 20, 20], [2, 2, 2], 2);
    expect(s.hd95).toBeGreaterThan(0);
    expect(s.hd95).toBeLessThanOrEqual(2 * Math.sqrt(3) + 1e-6);
    expect(s.nsd).toBeGreaterThan(0.5);
    const same = surfaceMetrics(a, a, [20, 20, 20], [1, 1, 1]);
    expect(same).toEqual({ hd95: 0, nsd: 1 });
  });

  it("distance map is exact Euclidean with anisotropic spacing", () => {
    const m = new Uint8Array(5 * 4 * 3);
    m[0] = 1;
    const d = distanceMap(m, [5, 4, 3], [1, 2, 3]);
    expect(d[0]).toBe(0);
    expect(d[4]).toBeCloseTo(4, 9);
    expect(d[(2 * 4 + 3) * 5 + 4]).toBeCloseTo(Math.hypot(4, 6, 6), 9);
  });

  it("compares label maps by canonical names (heart parts vs heart)", () => {
    const n = 10;
    const pred = new Float32Array(n * n * n), ref = new Float32Array(n * n * n);
    for (let i = 0; i < 300; i++) pred[i] = i < 150 ? 44 : 45;
    for (let i = 0; i < 300; i++) ref[i] = 51;
    for (let i = 500; i < 600; i++) {
      pred[i] = 5;
      ref[i] = 3;
    }
    const r = compareLabelMaps(pred, { "44": "heart_myocardium", "45": "heart_atrium_left", "5": "liver" }, ref, { "51": "heart", "3": "liver" });
    expect(r.map((x) => [x.name, x.dice])).toEqual([["heart", 1], ["liver", 1]]);
  });
});

describe("model input preparation", () => {
  it("MONAI normalization: nonzero z-score then scaled to [-1, 1]", () => {
    const v = Float32Array.from([0, -1000, 0, 100, 900]);
    normalizeForModel(v, { kind: "monai", nonzero: true, scaleTo: [-1, 1] });
    expect(Math.min(...v)).toBeCloseTo(-1, 6);
    expect(Math.max(...v)).toBeCloseTo(1, 6);
    // zeros stay at the value of 0 before scaling (between min and max)
    expect(v[0]).toBe(v[2]);
  });

  it("z-score normalization returns the body threshold", () => {
    const v = Float32Array.from([-2000, 0, 3000, NaN]);
    const t = normalizeForModel(v, { clip: [-1000, 1000], mean: 0, std: 500 });
    expect(Array.from(v)).toEqual([-2, 0, 2, -2]);
    expect(t).toBe(-1);
  });

  it("patch transposition round trip zyx ↔ xyz", () => {
    const dims: [number, number, number] = [2, 3, 4];
    const src = Float32Array.from({ length: 2 * 24 }, (_, i) => i);
    const xyz = transposePatch(src, dims, 2, true);
    // element (x=1, y=2, z=3) of channel 0: zyx index (3*3+2)*2+1 = 23, xyz index (1*3+2)*4+3 = 23 by coincidence; check another
    expect(xyz[(1 * 3 + 0) * 4 + 2]).toBe(src[(2 * 3 + 0) * 2 + 1]);
    expect(Array.from(transposePatch(xyz, dims, 2, false))).toEqual(Array.from(src));
  });
});
