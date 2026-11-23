import { describe, expect, it } from "vitest";
import { type Vec3, voxelToWorld, worldToVoxelTransform } from "../core/geometry";
import { IDENTITY_MAT4, IDENTITY_PARAMS, type Mat4, applyMat4, invert4, matrixFromParams, transformedWorldToVoxel } from "../core/transform";
import { resampleInto } from "../resample/resample";
import { Volume3D } from "../viewer/volume";
import { type CoregImage, coregister } from "./coregister";
import { powell } from "./powell";

describe("powell", () => {
  it("minimizes a correlated quadratic", () => {
    const f = (x: number[]) => (x[0] - 3) ** 2 + 10 * (x[1] + 1) ** 2 + (x[0] - 3) * (x[1] + 1) + 2;
    const r = powell(f, [0, 0], [[1, 0], [0, 1]], { tolerance: 1e-4, ftol: 1e-12 });
    expect(r.x[0]).toBeCloseTo(3, 3);
    expect(r.x[1]).toBeCloseTo(-1, 3);
  });
});

/** Asymmetric "head-like" phantom: ellipsoid body, a hot spot, a cold region and a bright rim. */
function phantom(n = 48, spacing = 3): Volume3D {
  const data = new Float32Array(n * n * n);
  const c = (n - 1) / 2;
  for (let k = 0; k < n; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = (i - c) / c, y = (j - c) / c, z = (k - c) / c;
        const r = (x / 0.8) ** 2 + (y / 0.65) ** 2 + (z / 0.75) ** 2;
        let v = 0;
        if (r < 1) v = 40 + 20 * x - 10 * z;
        if (r < 1 && r > 0.8) v = 90;
        if ((x - 0.3) ** 2 + (y + 0.2) ** 2 + (z - 0.25) ** 2 < 0.03) v = 200;
        if ((x + 0.35) ** 2 + (y - 0.1) ** 2 + (z + 0.1) ** 2 < 0.05) v = 10;
        if (Math.abs(x + 0.1) < 0.08 && Math.abs(y - 0.3) < 0.25 && Math.abs(z) < 0.4 && r < 1) v = 140;
        data[(k * n + j) * n + i] = v;
      }
  return new Volume3D(data, n, n, n, [spacing, spacing, spacing]);
}

const image = (v: Volume3D): CoregImage => ({ data: v.data, dims: [v.nx, v.ny, v.nz], geometry: v.geometry });

/** Moving image such that moving(q) = fixed(M·q): the correct moving→fixed matrix is M. */
function movedCopy(fixed: Volume3D, M: Mat4, remap?: (v: number) => number): Volume3D {
  const data = resampleInto(fixed, transformedWorldToVoxel(worldToVoxelTransform(fixed.geometry), invert4(M)), fixed, "linear");
  if (remap) for (let i = 0; i < data.length; i++) data[i] = remap(data[i]);
  return fixed.withData(data);
}

/** Mean distance (mm) between estimated and true positions of points spread over the volume. */
function meanError(fixed: Volume3D, est: Mat4, truth: Mat4): number {
  let s = 0;
  let n = 0;
  for (const f of [0.2, 0.5, 0.8])
    for (const g of [0.2, 0.5, 0.8])
      for (const h of [0.2, 0.5, 0.8]) {
        const p: Vec3 = voxelToWorld(fixed.geometry, f * fixed.nx, g * fixed.ny, h * fixed.nz);
        const a = applyMat4(est, p);
        const b = applyMat4(truth, p);
        s += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        n++;
      }
  return s / n;
}

describe("coregister", () => {
  const fixed = phantom();
  const center = voxelToWorld(fixed.geometry, 23.5, 23.5, 23.5);
  const truth = matrixFromParams({ ...IDENTITY_PARAMS, tx: 6, ty: -4, tz: 7, rx: 5, ry: -4, rz: 8 }, center);

  it("recovers a rigid transform within the same modality (NCC)", () => {
    const moving = movedCopy(fixed, truth);
    const r = coregister(image(fixed), image(moving), { dof: 6, cost: "ncc", levels: [8, 4, 3], coarseSearch: false, initial: IDENTITY_MAT4 });
    expect(meanError(fixed, r.matrix, truth)).toBeLessThan(1);
    expect(r.after).toBeLessThan(r.before);
  }, 60000);

  it("recovers a rigid transform between different contrasts (NMI and CR)", () => {
    // Non-monotonic intensity mapping simulates a different modality.
    const remap = (v: number) => (v < 5 ? 0 : v < 60 ? 150 - v : v < 120 ? 30 : 255 - v);
    const moving = movedCopy(fixed, truth, remap);
    for (const cost of ["nmi", "cr"] as const) {
      const r = coregister(image(fixed), image(moving), { dof: 6, cost, levels: [8, 4, 3], coarseSearch: false, initial: IDENTITY_MAT4 });
      expect(meanError(fixed, r.matrix, truth), cost).toBeLessThan(1);
    }
  }, 60000);

  it("recovers scaling with the affine model", () => {
    const scaled = matrixFromParams({ ...IDENTITY_PARAMS, tx: 3, rz: 4, sx: 1.05, sy: 0.96, sz: 1.03 }, center);
    const moving = movedCopy(fixed, scaled);
    const r = coregister(image(fixed), image(moving), { dof: 12, cost: "ncc", levels: [8, 4, 3], coarseSearch: false, initial: IDENTITY_MAT4 });
    expect(r.params.sx).toBeCloseTo(1.05, 1);
    expect(meanError(fixed, r.matrix, scaled)).toBeLessThan(1);
  }, 60000);

  it("keeps a landmark start position far outside the coarse grid (keepStart)", () => {
    // 120° about z plus 40 mm: unreachable for the ±30° grid, but the landmark start is close.
    const big = matrixFromParams({ ...IDENTITY_PARAMS, tx: 40, ty: -10, rz: 120 }, center);
    const moving = movedCopy(fixed, big);
    const start = matrixFromParams({ ...IDENTITY_PARAMS, tx: 44, ty: -6, rz: 112 }, center);
    const r = coregister(image(fixed), image(moving), { dof: 6, cost: "ncc", levels: [8, 4, 3], coarseSearch: true, keepStart: true, initial: start });
    expect(meanError(fixed, r.matrix, big)).toBeLessThan(2);
  });

  it("finds a large misrotation with the coarse search", () => {
    const rotated = matrixFromParams({ ...IDENTITY_PARAMS, tx: 15, ty: -10, rz: 25, rx: -10 }, center);
    const moving = movedCopy(fixed, rotated);
    const r = coregister(image(fixed), image(moving), { dof: 6, cost: "nmi", levels: [8, 4, 3], coarseSearch: true, initial: IDENTITY_MAT4 });
    expect(meanError(fixed, r.matrix, rotated)).toBeLessThan(1.5);
  }, 60000);

  it("switches coarse search on when the images start far apart (no common origin)", () => {
    // Same image content, but the moving header places it 200 mm away (as NIfTI files without a shared origin do).
    const shift: Vec3 = [200, -150, 60];
    const g = fixed.geometry;
    const moving = new Volume3D(fixed.data, fixed.nz, fixed.ny, fixed.nx, [g.spacing[2], g.spacing[1], g.spacing[0]], { ...g, origin: [g.origin[0] + shift[0], g.origin[1] + shift[1], g.origin[2] + shift[2]] });
    const truth = matrixFromParams({ ...IDENTITY_PARAMS, tx: -shift[0], ty: -shift[1], tz: -shift[2] }, [0, 0, 0]);
    const r = coregister(image(fixed), image(moving), { dof: 6, cost: "nmi", levels: [8, 4, 3], coarseSearch: false, initial: IDENTITY_MAT4 });
    expect(r.autoCoarse).toBe(true);
    expect(meanError(fixed, invert4(r.matrix), invert4(truth))).toBeLessThan(1.5);
    // A small misalignment does not trigger it.
    const small = coregister(image(fixed), image(movedCopy(fixed, matrixFromParams({ ...IDENTITY_PARAMS, tx: 5 }, center))), { dof: 6, cost: "nmi", levels: [8, 4, 3], coarseSearch: false, initial: IDENTITY_MAT4 });
    expect(small.autoCoarse).toBe(false);
  }, 60000);
});
