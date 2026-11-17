import { describe, expect, it } from "vitest";
import { applyWorldToVoxel, voxelToWorld, worldToVoxelTransform } from "./geometry";
import {
  IDENTITY_PARAMS,
  type TransformParams,
  applyMat4,
  invert4,
  matrixFromParams,
  multiply4,
  paramsFromMatrix,
  transformedWorldToVoxel,
} from "./transform";
import { Volume3D } from "../viewer/volume";
import { customGrid, resampleInto } from "../resample/resample";

const close = (a: number[], b: number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const center: [number, number, number] = [10, -20, 35];
const affine: TransformParams = { tx: 4, ty: -7, tz: 2.5, rx: 6, ry: -11, rz: 23, sx: 1.04, sy: 0.97, sz: 1.01, hxy: 0.02, hxz: -0.01, hyz: 0.03 };

describe("transform model", () => {
  it("round-trips parameters through the matrix (rigid and affine)", () => {
    for (const p of [{ ...IDENTITY_PARAMS, tx: 3, rx: 10, ry: -5, rz: 40 }, affine]) {
      const back = paramsFromMatrix(matrixFromParams(p, center), center)!;
      close(Object.values(back), Object.values(p), 8);
    }
  });

  it("matches the rigid convention p' = R(p − c) + c + t", () => {
    const M = matrixFromParams({ ...IDENTITY_PARAMS, tz: 5, rz: 90 }, [0, 0, 0]);
    close(applyMat4(M, [1, 0, 0]), [0, 1, 5]);
  });

  it("inverts and composes", () => {
    const M = matrixFromParams(affine, center);
    close(multiply4(M, invert4(M)), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 10);
    const p: [number, number, number] = [3, -4, 5];
    close(applyMat4(invert4(M), applyMat4(M, p)), p, 10);
  });

  it("rejects reflections", () => {
    expect(paramsFromMatrix([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 0, 0])).toBeNull();
  });

  it("maps the moved position of a voxel back to that voxel", () => {
    const vol = new Volume3D(new Float32Array(8), 2, 2, 2, [2, 3, 4]);
    const M = matrixFromParams(affine, center);
    const base = worldToVoxelTransform(vol.geometry);
    const moved = applyMat4(M, voxelToWorld(vol.geometry, 1.5, 0.25, 3));
    close(applyWorldToVoxel(transformedWorldToVoxel(base, M), moved), [1.5, 0.25, 3], 9);
  });
});

function ramp(n: number, f: (x: number, y: number, z: number) => number) {
  const d = new Float32Array(n * n * n);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) d[(z * n + y) * n + x] = f(x, y, z);
  return new Volume3D(d, n, n, n, [1, 1, 1]);
}

describe("resampling", () => {
  it("reproduces source values on the same grid for all interpolations", () => {
    const vol = ramp(8, (x, y, z) => Math.sin(x) + y * y - z);
    for (const m of ["nearest", "linear", "bspline"] as const) {
      const out = resampleInto(vol, worldToVoxelTransform(vol.geometry), vol, m);
      out.forEach((v, i) => expect(v).toBeCloseTo(vol.data[i], 3));
    }
  });

  it("interpolates between voxels (linear exact for linear data, B-spline exact for cubics inside)", () => {
    const lin = ramp(10, (x, y, z) => 2 * x + 3 * y - z);
    const cubic = ramp(12, (x) => x * x * x / 50);
    const half = { nx: 1, ny: 1, nz: 1, geometry: { ...lin.geometry, origin: [4.5, 4.5, 4.5] as [number, number, number] } };
    expect(resampleInto(lin, worldToVoxelTransform(lin.geometry), half, "linear")[0]).toBeCloseTo(2 * 4.5 + 3 * 4.5 - 4.5, 5);
    const at = { nx: 1, ny: 1, nz: 1, geometry: { ...cubic.geometry, origin: [5.3, 5, 5] as [number, number, number] } };
    expect(resampleInto(cubic, worldToVoxelTransform(cubic.geometry), at, "bspline")[0]).toBeCloseTo(5.3 ** 3 / 50, 2);
    expect(resampleInto(cubic, worldToVoxelTransform(cubic.geometry), at, "nearest")[0]).toBeCloseTo(125 / 50, 5);
  });

  it("customGrid keeps field of view and center", () => {
    const vol = new Volume3D(new Float32Array(200 * 200 * 100), 100, 200, 200, [3, 2, 2]);
    const g = customGrid(vol, { matrix: [128, 128, 100] });
    expect(g.geometry.spacing[0]).toBeCloseTo(400 / 128, 9);
    const c0 = voxelToWorld(vol.geometry, 99.5, 99.5, 49.5);
    close(voxelToWorld(g.geometry, 63.5, 63.5, 49.5), c0, 9);
    const iso = customGrid(vol, { voxelMm: [4, 4, 4] });
    expect([iso.nx, iso.ny, iso.nz]).toEqual([100, 100, 75]);
  });
});
