import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { voxelToWorld, worldToVoxelTransform } from "../core/geometry";
import { IDENTITY_MAT4 } from "../core/transform";
import { resampleAtPoints } from "../resample/resample";
import { parseNifti1 } from "../viewer/volumeLoader";
import { type Basis3, choleskySolve, dctBasis, project, synthesize } from "./dct";
import { estimateWarp } from "./warp";

const load = (name: string) => {
  const raw = gunzipSync(readFileSync(fileURLToPath(new URL(`../../public/templates/${name}`, import.meta.url))));
  return parseNifti1(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer).volume;
};

describe("DCT basis", () => {
  it("is orthonormal and synthesize/project are adjoint", () => {
    const n = 12;
    const B = dctBasis(n, 5, [...Array(n).keys()]);
    for (let p = 0; p < 5; p++)
      for (let q = 0; q < 5; q++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += B[i * 5 + p] * B[i * 5 + q];
        expect(s).toBeCloseTo(p === q ? 1 : 0, 10);
      }
    const b: Basis3 = { bx: dctBasis(7, 3, [0, 2, 4, 6]), by: dctBasis(5, 2, [0, 1, 3]), bz: dctBasis(6, 2, [1, 4]), kx: 3, ky: 2, kz: 2, nx: 4, ny: 3, nz: 2 };
    const c = Float64Array.from({ length: 12 }, (_, i) => Math.sin(i + 1));
    const f = Float64Array.from({ length: 24 }, (_, i) => Math.cos(i * 0.7));
    const lhs = synthesize(b, c).reduce((a, v, i) => a + v * f[i], 0);
    const rhs = project(b, f).reduce((a, v, i) => a + v * c[i], 0);
    expect(lhs).toBeCloseTo(rhs, 10);
  });

  it("solves SPD systems", () => {
    const A = Float64Array.from([4, 1, 0, 1, 3, 1, 0, 1, 2]);
    const x = choleskySolve(A, Float64Array.from([1, 2, 3]), 3);
    const A0 = [4, 1, 0, 1, 3, 1, 0, 1, 2];
    [0, 1, 2].forEach((i) => expect(A0[i * 3] * x[0] + A0[i * 3 + 1] * x[1] + A0[i * 3 + 2] * x[2]).toBeCloseTo([1, 2, 3][i], 10));
  });
});

describe("nonlinear normalization", () => {
  it("recovers a known smooth deformation of the MNI template", () => {
    const t = load("MNI152NLin2009cAsym_res-02_T1w.nii.gz");
    const mask = load("MNI152NLin2009cAsym_res-02_brainmask.nii.gz").data.map((v) => (v > 0.5 ? 1 : 0));
    const { nx, ny, nz } = t;
    // True displacement (mm, template world): smooth bumps of a few mm.
    const c = voxelToWorld(t.geometry, nx / 2, ny / 2, nz / 2);
    const dTrue = (p: number[]): [number, number, number] => {
      const u = (p[0] - c[0]) / 70, v = (p[1] - c[1]) / 80, w = (p[2] - c[2]) / 70;
      return [4 * Math.sin(Math.PI * v) * Math.cos(Math.PI * w * 0.5), -3 * Math.sin(Math.PI * u * 0.7) * Math.cos(Math.PI * v * 0.5), 3.5 * Math.cos(Math.PI * u * 0.5) * Math.sin(Math.PI * w * 0.6)];
    };
    // Subject so that subject(x + d(x)) = template(x): subject(q) = template(x) with x = q − d(x) (fixed point).
    const points = new Float32Array(nx * ny * nz * 3);
    for (let k = 0, o = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++, o++) {
          const q = voxelToWorld(t.geometry, i, j, k);
          let x = q;
          for (let it = 0; it < 5; it++) {
            const d = dTrue(x);
            x = [q[0] - d[0], q[1] - d[1], q[2] - d[2]];
          }
          points.set(x, 3 * o);
        }
    const subject = t.withData(resampleAtPoints(t, worldToVoxelTransform(t.geometry), points, "linear"));
    const r = estimateWarp(
      {
        template: { data: t.data, dims: [nx, ny, nz], geometry: t.geometry },
        subject: { data: subject.data, dims: [nx, ny, nz], geometry: subject.geometry },
        affine: IDENTITY_MAT4,
        weights: mask,
      },
      { cutoffMm: 30, regularization: 0.05, iterations: 10, fwhmMm: 6, sampleStep: 2 },
    );
    // Compare estimated with true displacement inside the brain.
    let errBefore = 0, errAfter = 0, n = 0;
    for (let k = 0, o = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++, o++) {
          if (!mask[o]) continue;
          const x = voxelToWorld(t.geometry, i, j, k);
          const d = dTrue(x);
          const est = [r.field[3 * o] - x[0], r.field[3 * o + 1] - x[1], r.field[3 * o + 2] - x[2]];
          errBefore += Math.hypot(d[0], d[1], d[2]);
          errAfter += Math.hypot(est[0] - d[0], est[1] - d[1], est[2] - d[2]);
          n++;
        }
    console.log(`mean displacement ${(errBefore / n).toFixed(2)} mm → residual ${(errAfter / n).toFixed(2)} mm, folded ${r.foldedFraction}`);
    expect(errAfter / n).toBeLessThan(0.3 * (errBefore / n));
    expect(errAfter / n).toBeLessThan(1);
    expect(r.costAfter).toBeLessThan(r.costBefore);
    expect(r.foldedFraction).toBe(0);
  }, 300000);

  it("estimates the weight of an additional template component (adaptive template)", () => {
    const t = load("MNI152NLin2009cAsym_res-02_T1w.nii.gz");
    const mask = load("MNI152NLin2009cAsym_res-02_brainmask.nii.gz").data.map((v) => (v > 0.5 ? 1 : 0));
    const { nx, ny, nz } = t;
    // Component: smooth left–right asymmetric "uptake" pattern inside the brain.
    const comp = new Float32Array(t.data.length);
    for (let k = 0, o = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++, o++) comp[o] = mask[o] * 60 * (1 + Math.sin(i / 8) * Math.cos(k / 10));
    const c = voxelToWorld(t.geometry, nx / 2, ny / 2, nz / 2);
    const dTrue = (p: number[]) => [3 * Math.sin((p[1] - c[1]) / 30), -2 * Math.cos((p[2] - c[2]) / 35), 2.5 * Math.sin((p[0] - c[0]) / 40)];
    const mixed = t.withData(t.data.map((v, i) => v + 0.7 * comp[i]));
    const points = new Float32Array(nx * ny * nz * 3);
    for (let k = 0, o = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++, o++) {
          const q = voxelToWorld(t.geometry, i, j, k);
          let x = q;
          for (let it = 0; it < 5; it++) {
            const d = dTrue(x);
            x = [q[0] - d[0], q[1] - d[1], q[2] - d[2]];
          }
          points.set(x, 3 * o);
        }
    const subject = t.withData(resampleAtPoints(mixed, worldToVoxelTransform(t.geometry), points, "linear"));
    const r = estimateWarp(
      { template: { data: t.data, dims: [nx, ny, nz], geometry: t.geometry }, subject: { data: subject.data, dims: [nx, ny, nz], geometry: t.geometry }, affine: IDENTITY_MAT4, weights: mask, components: [comp] },
      { cutoffMm: 30, regularization: 0.05, iterations: 10, fwhmMm: 6, sampleStep: 2 },
    );
    expect(r.componentWeights[0]).toBeGreaterThan(0.6);
    expect(r.componentWeights[0]).toBeLessThan(0.8);
    let err = 0, n = 0;
    for (let k = 0, o = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++, o++) {
          if (!mask[o]) continue;
          const x = voxelToWorld(t.geometry, i, j, k);
          const d = dTrue(x);
          err += Math.hypot(r.field[3 * o] - x[0] - d[0], r.field[3 * o + 1] - x[1] - d[1], r.field[3 * o + 2] - x[2] - d[2]);
          n++;
        }
    console.log(`component weight ${r.componentWeights[0].toFixed(3)}, residual ${(err / n).toFixed(2)} mm`);
    expect(err / n).toBeLessThan(1);
  }, 300000);
});
