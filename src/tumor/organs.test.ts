import { describe, expect, it } from "vitest";
import { worldToVoxelTransform } from "../core/geometry";
import { Volume3D } from "../viewer/volume";
import { EXCLUSION_PRESETS, annotateLesions, autoLiverCenter, isBone, organsOnGrid } from "./organs";
import { lesionStats } from "./segment";

const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]];

describe("organ coupling", () => {
  it("excludes lesions mainly in physiological organs and marks bone lesions", () => {
    const n = 20;
    const geom = { origin: [0, 0, 0] as [number, number, number], axes, spacing: [2, 2, 2] as [number, number, number] };
    const pet = new Volume3D(new Float32Array(n * n * n).fill(1), n, n, n, [2, 2, 2], geom);
    const organs = new Uint8Array(n * n * n);
    const lesions = new Int32Array(n * n * n);
    const box = (lab: Int32Array | Uint8Array, v: number, x0: number, x1: number) => {
      for (let k = 5; k < 10; k++) for (let j = 5; j < 10; j++) for (let i = x0; i < x1; i++) lab[(k * n + j) * n + i] = v;
    };
    box(organs, 2, 0, 8); // kidney_right
    box(organs, 30, 12, 20); // vertebrae_L1
    box(lesions, 1, 1, 7); // lesion 1 inside the kidney
    box(lesions, 2, 13, 16); // lesion 2 in bone
    const names = new Map([[2, "kidney right"], [30, "vertebrae L1"]]);
    const ls = annotateLesions(lesionStats(pet, lesions, 1), lesions, organs, names, new Set(EXCLUSION_PRESETS.psma));
    expect(ls[0].included).toBe(false);
    expect(ls[0].note).toContain("kidney right");
    expect(ls[1].included).toBe(true);
    expect(ls[1].bone).toBe(true);
    expect(isBone("rib left 3")).toBe(true);
    expect(isBone("liver")).toBe(false);
  });

  it("transfers labels onto another grid and finds a liver center in the right lobe interior", () => {
    const geom = { origin: [0, 0, 0] as [number, number, number], axes, spacing: [3, 3, 3] as [number, number, number] };
    const n = 40;
    const lab = new Volume3D(new Float32Array(n * n * n), n, n, n, [3, 3, 3], geom);
    // "Liver": box x 6–34, y 10–30, z 10–30 (label 5).
    for (let k = 10; k < 30; k++) for (let j = 10; j < 30; j++) for (let i = 6; i < 34; i++) lab.data[(k * n + j) * n + i] = 5;
    const c = autoLiverCenter(lab, 5)!;
    expect(c).not.toBeNull();
    // Right lobe = smaller LPS x than the liver center (x ≈ 60 mm).
    expect(c[0]).toBeLessThan(60);
    expect(c[0]).toBeGreaterThanOrEqual(6 * 3 + 15);
    const pet = new Volume3D(new Float32Array(30 * 30 * 30), 30, 30, 30, [4, 4, 4], { ...geom, spacing: [4, 4, 4] });
    const o = organsOnGrid(lab, worldToVoxelTransform(lab.geometry), pet);
    expect(o[(15 * 30 + 15) * 30 + 10]).toBe(5); // (40, 60, 60) mm → label voxel (13.3, 20, 20) → liver
    expect(o[0]).toBe(0);
  });
});
