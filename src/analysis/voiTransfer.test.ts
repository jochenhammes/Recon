import { describe, expect, it } from "vitest";
import { worldToVoxelTransform } from "../core/geometry";
import { IDENTITY_MAT4, IDENTITY_PARAMS, matrixFromParams, transformedWorldToVoxel } from "../core/transform";
import { voiMask } from "../edit/voi";
import { Volume3D } from "../viewer/volume";
import { transferVoi } from "./voiTransfer";

const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]];

describe("VOI transfer between datasets", () => {
  it("maps a sphere VOI through the registration onto another grid", () => {
    const src = new Volume3D(new Float32Array(50 * 50 * 50), 50, 50, 50, [2, 2, 2], { origin: [0, 0, 0], axes, spacing: [2, 2, 2] });
    const mask = voiMask(src, { kind: "sphere", center: [50, 50, 50], radius: 20 });
    // Target: 4 mm grid in its own coordinates, placed in the reference world shifted by +10 mm in x.
    const tgtGeom = { origin: [-20, 0, 0] as [number, number, number], axes, spacing: [4, 4, 4] as [number, number, number] };
    const target = new Volume3D(new Float32Array(30 * 30 * 30), 30, 30, 30, [4, 4, 4], tgtGeom);
    const matrix = matrixFromParams({ ...IDENTITY_PARAMS, tx: 10 }, [0, 0, 0]);
    const row = { id: "t", label: "t", volume: target, matrix, w2v: transformedWorldToVoxel(worldToVoxelTransform(tgtGeom), matrix), scale: 1, unitLabel: "" };
    const r = transferVoi({ mask, volume: src, w2v: worldToVoxelTransform(src.geometry), bounds: null, label: "" }, row)!;
    let n = 0, cx = 0;
    for (let k = 0, o = 0; k < 30; k++)
      for (let j = 0; j < 30; j++)
        for (let i = 0; i < 30; i++, o++)
          if (r.mask[o]) {
            n++;
            cx += -20 + 4 * i;
          }
    // Sphere volume 4/3·π·20³ ≈ 33.5 ml → ≈ 524 voxels of 64 mm³; center in target coordinates: x = 50 − 10 = 40.
    expect(n * 64).toBeGreaterThan(0.85 * 33510);
    expect(n * 64).toBeLessThan(1.15 * 33510);
    expect(cx / n).toBeCloseTo(40, 0);
    expect(IDENTITY_MAT4).toBeDefined();
  });
});
