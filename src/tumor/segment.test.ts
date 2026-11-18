import { describe, expect, it } from "vitest";
import { Volume3D } from "../viewer/volume";
import { tumorBurden } from "./metrics";
import { connectedComponents, segmentLesions } from "./segment";

const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]];

/** 2 mm phantom 100×100×100 with background SUV 1 and hot spheres (center mm, radius mm, SUV). */
function phantom(spheres: { c: [number, number, number]; r: number; suv: number }[]) {
  const n = 100;
  const data = new Float32Array(n * n * n).fill(1);
  for (let k = 0, o = 0; k < n; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++, o++)
        for (const s of spheres) if (Math.hypot(2 * i - s.c[0], 2 * j - s.c[1], 2 * k - s.c[2]) <= s.r) data[o] = s.suv;
  return new Volume3D(data, n, n, n, [2, 2, 2], { origin: [0, 0, 0], axes, spacing: [2, 2, 2] });
}
const sphereMl = (r: number) => ((4 / 3) * Math.PI * r ** 3) / 1000;

describe("tumor segmentation", () => {
  it("labels 26-connected components (diagonal neighbours belong together)", () => {
    const inside = new Set([0, 1 + 3 + 9, 26]); // (0,0,0), (1,1,1) diagonal, (2,2,2) diagonal
    const labels = new Int32Array(27);
    expect(connectedComponents(3, 3, 3, (i) => inside.has(i), labels)).toBe(1);
  });

  it("absolute threshold finds spheres with their volume, SUVmax and TLG; small ones are dropped", () => {
    const v = phantom([
      { c: [50, 50, 50], r: 20, suv: 10 },
      { c: [150, 150, 150], r: 12, suv: 6 },
      { c: [50, 150, 100], r: 3, suv: 8 }, // ~0.1 ml → below minimum volume
    ]);
    const s = segmentLesions(v, { method: { kind: "absolute", suv: 4 }, suvFactor: 1, minVolumeMl: 0.5 });
    expect(s.lesions).toHaveLength(2);
    const big = s.lesions.find((l) => l.suvMax === 10)!;
    expect(big.volumeMl).toBeGreaterThan(0.9 * sphereMl(20));
    expect(big.volumeMl).toBeLessThan(1.1 * sphereMl(20));
    expect(big.suvMean).toBeCloseTo(10, 5);
    expect(big.tlg).toBeCloseTo(big.volumeMl * 10, 5);
    expect(big.suvPeak).toBeCloseTo(10, 5);
    const b = tumorBurden(s.lesions);
    expect(b.lesions).toBe(2);
    expect(b.dmax).toBeCloseTo(Math.hypot(100, 100, 100), 0);
    expect(b.dmaxBulk).toBeCloseTo(b.dmax, 0);
  });

  it("SUV factor converts raw values; exclusion mask removes voxels", () => {
    const v = phantom([{ c: [100, 100, 100], r: 16, suv: 10000 }]);
    const s = segmentLesions(v, { method: { kind: "absolute", suv: 4 }, suvFactor: 1 / 1000, minVolumeMl: 0.1 });
    expect(s.lesions[0].suvMax).toBeCloseTo(10, 6);
    const ex = new Uint8Array(v.data.length).fill(1);
    expect(segmentLesions(v, { method: { kind: "absolute", suv: 4 }, suvFactor: 1 / 1000, minVolumeMl: 0.1, exclude: ex }).lesions).toHaveLength(0);
  });

  it("41 % SUVmax adapts per lesion; liver threshold uses mean and SD", () => {
    // Sphere with a hot core: 41 % of 20 = 8.2 → only the core (SUV 20) is kept, the rim (SUV 6) not.
    const v = phantom([
      { c: [100, 100, 100], r: 20, suv: 6 },
      { c: [100, 100, 100], r: 8, suv: 20 },
    ]);
    const rel = segmentLesions(v, { method: { kind: "percentMax", percent: 0.41, detectSuv: 2.5 }, suvFactor: 1, minVolumeMl: 0.1 });
    expect(rel.lesions).toHaveLength(1);
    expect(rel.lesions[0].volumeMl).toBeLessThan(1.3 * sphereMl(8));
    const liver = segmentLesions(v, { method: { kind: "liver", a: 1.5, b: 2, liverMean: 2, liverSd: 0.5 }, suvFactor: 1, minVolumeMl: 0.1 });
    expect(liver.thresholdSuv).toBe(4);
    expect(liver.lesions[0].volumeMl).toBeGreaterThan(0.9 * sphereMl(20));
  });
});

describe("lesion cleanup", () => {
  it("removes excluded lesions and renumbers the rest in the given order", async () => {
    const { cleanupLesions } = await import("./segment");
    const base = { voxels: 1, volumeMl: 1, suvMean: 1, suvPeak: 1, tlg: 1, centroid: [0, 0, 0] as [number, number, number], maxIndex: 0 };
    const lesions = [
      { ...base, id: 1, suvMax: 3, included: true },
      { ...base, id: 2, suvMax: 9, included: false, reviewed: true },
      { ...base, id: 5, suvMax: 7, included: true, reviewed: true },
    ];
    const labels = Int32Array.from([0, 1, 2, 5, 5, 2, 1]);
    const r = cleanupLesions(labels, lesions, (a, b) => b.suvMax - a.suvMax);
    expect(Array.from(r.labels)).toEqual([0, 2, 0, 1, 1, 0, 2]);
    expect(r.lesions.map((l) => [l.id, l.suvMax, l.reviewed ?? false])).toEqual([
      [1, 7, true],
      [2, 3, false],
    ]);
  });
});
