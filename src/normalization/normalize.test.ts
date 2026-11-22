import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { voxelToWorld, worldToVoxelTransform } from "../core/geometry";
import { IDENTITY_MAT4, IDENTITY_PARAMS, applyMat4, invert4, matrixFromParams, transformedWorldToVoxel } from "../core/transform";
import { coregister } from "../registration/coregister";
import { resampleAtPoints, resampleInto } from "../resample/resample";
import { Volume3D } from "../viewer/volume";
import { parseNifti1 } from "../viewer/volumeLoader";
import { type Normalization, fieldFromAffine, pullbackPositions } from "./model";

const load = (name: string) => {
  const raw = gunzipSync(readFileSync(fileURLToPath(new URL(`../../public/templates/${name}`, import.meta.url))));
  return parseNifti1(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer).volume;
};

function correlation(a: Float32Array, b: Float32Array, mask: Float32Array): number {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < a.length; i++) {
    if (!(mask[i] > 0.5)) continue;
    n++;
    sa += a[i];
    sb += b[i];
    saa += a[i] * a[i];
    sbb += b[i] * b[i];
    sab += a[i] * b[i];
  }
  return (sab - (sa * sb) / n) / Math.sqrt((saa - (sa * sa) / n) * (sbb - (sb * sb) / n));
}

describe("affine normalization to the MNI template", () => {
  const template = load("MNI152NLin2009cAsym_res-02_T1w.nii.gz");
  const mask = load("MNI152NLin2009cAsym_res-02_brainmask.nii.gz").data.map((v) => (v > 0.5 ? 1 : 0));
  // "Subject" T1 in scanner coordinates: template moved/rotated/scaled by a known transform S.
  const center = voxelToWorld(template.geometry, 48, 57, 48);
  const S = matrixFromParams({ ...IDENTITY_PARAMS, tx: 60, ty: -25, tz: 40, rx: 8, ry: -5, rz: 12, sx: 1.06, sy: 0.95, sz: 1.03 }, center);
  // Subject grid: shifted copy of the template grid (so it covers the moved head) with 2.5 mm voxels.
  const subjectGrid = {
    nx: 90,
    ny: 100,
    nz: 85,
    geometry: { ...template.geometry, origin: applyMat4(S, voxelToWorld(template.geometry, -5, -5, -5)), spacing: [2.5, 2.5, 2.5] as [number, number, number] },
  };
  // subject(q) = template(S⁻¹ q)
  const subjectData = resampleInto(template, transformedWorldToVoxel(worldToVoxelTransform(template.geometry), S), subjectGrid, "linear");
  const subject = new Volume3D(subjectData, subjectGrid.nz, subjectGrid.ny, subjectGrid.nx, [2.5, 2.5, 2.5], subjectGrid.geometry);

  it("recovers the subject→template affine and transfers a dataset into standard space", () => {
    const r = coregister(
      { data: template.data, dims: [template.nx, template.ny, template.nz], geometry: template.geometry },
      { data: subject.data, dims: [subject.nx, subject.ny, subject.nz], geometry: subject.geometry },
      { dof: 12, cost: "ncc", levels: [8, 4], coarseSearch: true, initial: IDENTITY_MAT4, fixedMask: mask },
    );
    // r.matrix should map subject → template, i.e. ≈ S⁻¹.
    const truth = invert4(S);
    let err = 0;
    let n = 0;
    for (const f of [0.3, 0.5, 0.7])
      for (const g of [0.3, 0.5, 0.7])
        for (const h of [0.3, 0.5, 0.7]) {
          const p = voxelToWorld(subject.geometry, f * subject.nx, g * subject.ny, h * subject.nz);
          const a = applyMat4(r.matrix, p);
          const b = applyMat4(truth, p);
          err += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          n++;
        }
    expect(err / n).toBeLessThan(1.5);

    // Transfer: the subject resampled through the pull-back field must match the template.
    const grid = { nx: template.nx, ny: template.ny, nz: template.nz, geometry: template.geometry };
    const norm: Normalization = { subjectId: "s", templateName: "MNI", grid, affine: r.matrix, field: fieldFromAffine(grid, r.matrix), kind: "affine" };
    const points = pullbackPositions(norm, IDENTITY_MAT4);
    const back = resampleAtPoints(subject, worldToVoxelTransform(subject.geometry), points, "linear");
    // Limited by the 2 mm → 2.5 mm → 2 mm resolution loss of the synthetic subject, not by the alignment.
    expect(correlation(back, template.data, mask)).toBeGreaterThan(0.95);
  }, 180000);
});

describe("normalization on another grid", () => {
  it("resampleField keeps an affine normalization exact and interpolates a smooth warp", async () => {
    const { fieldFromAffine, resampleField } = await import("./model");
    const { voxelToWorld } = await import("../core/geometry");
    const g2 = { nx: 20, ny: 22, nz: 18, geometry: { origin: [-19, -21, -17] as [number, number, number], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]], spacing: [2, 2, 2] as [number, number, number] } };
    const g1 = { nx: 40, ny: 44, nz: 36, geometry: { ...g2.geometry, origin: [-19.5, -21.5, -17.5] as [number, number, number], spacing: [1, 1, 1] as [number, number, number] } };
    const A = [1.1, 0.05, 0, 3, -0.02, 0.95, 0.1, -2, 0, 0.03, 1.05, 1, 0, 0, 0, 1];
    const n = { subjectId: "s", templateName: "t", grid: g2, affine: A, field: fieldFromAffine(g2, A), kind: "affine" as const };
    const r = resampleField(n, g1);
    const exact = fieldFromAffine(g1, A);
    let maxErr = 0;
    for (let i = 0; i < exact.length; i++) maxErr = Math.max(maxErr, Math.abs(r.field[i] - exact[i]));
    expect(maxErr).toBeLessThan(1e-3);
    // Smooth extra displacement d(x) = 2·sin(x/15): interpolation error small inside the grid.
    const warped = Float32Array.from(n.field);
    for (let k = 0, o = 0; k < g2.nz; k++) for (let j = 0; j < g2.ny; j++) for (let i = 0; i < g2.nx; i++, o += 3) warped[o] += 2 * Math.sin(voxelToWorld(g2.geometry, i, j, k)[0] / 15);
    const rw = resampleField({ ...n, field: warped, kind: "nonlinear" }, g1);
    let e2 = 0;
    for (let k = 2; k < g1.nz - 2; k++)
      for (let j = 2; j < g1.ny - 2; j++)
        for (let i = 2; i < g1.nx - 2; i++) {
          const o = 3 * ((k * g1.ny + j) * g1.nx + i);
          const want = exact[o] + 2 * Math.sin(voxelToWorld(g1.geometry, i, j, k)[0] / 15);
          e2 = Math.max(e2, Math.abs(rw.field[o] - want));
        }
    expect(e2).toBeLessThan(0.02);
  });

  it("coarseTemplate averages 1 mm blocks to 2 mm with the right geometry", async () => {
    const { coarseTemplate } = await import("./templates");
    const { Volume3D } = await import("../viewer/volume");
    const { voxelToWorld } = await import("../core/geometry");
    const data = new Float32Array(8 * 8 * 8).map((_, i) => i % 8); // value = x index
    const g = { origin: [-3.5, -3.5, -3.5] as [number, number, number], axes: [[-1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]], spacing: [1, 1, 1] as [number, number, number] };
    const v = new Volume3D(data, 8, 8, 8, [1, 1, 1], g);
    const c = coarseTemplate(v, new Float32Array(512).fill(1));
    expect([c.volume.nx, c.volume.ny, c.volume.nz]).toEqual([4, 4, 4]);
    expect(c.volume.data[1]).toBeCloseTo(2.5);
    // Centre of coarse voxel 1 = centre of fine voxels 2 and 3.
    const w = voxelToWorld(c.volume.geometry, 1, 0, 0);
    const f = voxelToWorld(g, 2.5, 0.5, 0.5);
    expect(w.map((x, i) => Math.abs(x - f[i])).every((d) => d < 1e-9)).toBe(true);
    expect(c.mask!.every((x) => x === 1)).toBe(true);
  });
});
