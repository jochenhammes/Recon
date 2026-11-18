import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { voxelToWorld, worldToVoxelTransform } from "../core/geometry";
import { IDENTITY_MAT4, IDENTITY_PARAMS, applyMat4, invert4, matrixFromParams, transformedWorldToVoxel } from "../core/transform";
import { coregister } from "../registration/coregister";
import { resampleInto } from "../resample/resample";
import { parseNifti1 } from "../viewer/volumeLoader";

const load = (name: string) => {
  const raw = gunzipSync(readFileSync(fileURLToPath(new URL(`../../public/templates/${name}`, import.meta.url))));
  return parseNifti1(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer).volume;
};

describe("normalization of a head CT to the SPM transmission template", () => {
  it("recovers the CT→template affine (two stages as in the app: NMI coarse, then correlation)", () => {
    const template = load("spm12_Transm.nii.gz");
    let max = 0;
    for (const v of template.data) max = Math.max(max, v);
    // Pseudo-CT in scanner coordinates: template moved/rotated/scaled, intensities mapped non-linearly to HU
    // (air −1000, soft tissue ≈ 40, bone up to ≈ 1500) with noise and 1.2 × 1.2 × 3 mm voxels.
    const center = voxelToWorld(template.geometry, 45, 54, 45);
    const S = matrixFromParams({ ...IDENTITY_PARAMS, tx: -40, ty: 30, tz: -150, rx: -10, ry: 6, rz: 4, sx: 1.05, sy: 0.97, sz: 1.04 }, center);
    const spacing: [number, number, number] = [1.2, 1.2, 3];
    const grid = {
      nx: 170,
      ny: 200,
      nz: 70,
      geometry: { ...template.geometry, origin: applyMat4(S, voxelToWorld(template.geometry, -8, -8, -6)), spacing },
    };
    const moved = resampleInto(template, transformedWorldToVoxel(worldToVoxelTransform(template.geometry), S), grid, "linear");
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    const ct = Float32Array.from(moved, (v) => {
      const r = v / max;
      const hu = r < 0.15 ? -1000 : r < 0.8 ? -1000 + ((r - 0.15) / (0.8 - 0.15)) * 1040 : 40 + ((r - 0.8) / 0.2) * 1460;
      return hu + 30 * rnd();
    });
    const clamped = ct.map((v) => Math.min(2000, Math.max(-1000, v)));
    const fixed = { data: template.data, dims: [template.nx, template.ny, template.nz] as [number, number, number], geometry: template.geometry };
    const moving = { data: clamped, dims: [grid.nx, grid.ny, grid.nz] as [number, number, number], geometry: grid.geometry };
    const r0 = coregister(fixed, moving, { dof: 12, cost: "nmi", levels: [8, 4], coarseSearch: true, initial: IDENTITY_MAT4 });
    const r = coregister(fixed, moving, { dof: 12, cost: "ncc", levels: [4, 2], coarseSearch: false, initial: r0.matrix });
    const truth = invert4(S);
    let err = 0, n = 0;
    for (const f of [0.3, 0.5, 0.7])
      for (const g of [0.3, 0.5, 0.7])
        for (const h of [0.3, 0.5, 0.7]) {
          const p = voxelToWorld(grid.geometry, f * grid.nx, g * grid.ny, h * grid.nz);
          const a = applyMat4(r.matrix, p), b = applyMat4(truth, p);
          err += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          n++;
        }
    expect(err / n).toBeLessThan(2.5);
  }, 120000);
});
