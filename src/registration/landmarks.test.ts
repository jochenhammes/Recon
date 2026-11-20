import { describe, expect, it } from "vitest";
import { type Vec3, type VolumeGeometry, voxelToWorld } from "../core/geometry";
import { IDENTITY_MAT4, IDENTITY_PARAMS, applyMat4, invert4, matrixFromParams } from "../core/transform";
import { alignByLandmark, alignTwoLandmarks, derivedFrameOfReference, originShift, reorientPlan, rigidFromPairs } from "./landmarks";

const pts: Vec3[] = [[0, 0, 0], [100, 0, 0], [0, 80, 10], [20, 30, 120], [-40, 10, 60]];

describe("landmarks", () => {
  it("rigidFromPairs recovers rotation and translation, also 90° and 180°", () => {
    for (const [rx, ry, rz] of [[10, -20, 35], [90, 0, 0], [0, 180, 0], [0, 0, -90], [170, 45, -120]]) {
      const M = matrixFromParams({ ...IDENTITY_PARAMS, tx: 12, ty: -40, tz: 300, rx, ry, rz }, [5, 5, 5]);
      const fit = rigidFromPairs(pts.map((p) => ({ from: p, to: applyMat4(M, p) })))!;
      expect(fit.rms).toBeLessThan(1e-6);
      for (let i = 0; i < 16; i++) expect(fit.matrix[i]).toBeCloseTo(M[i], 6);
    }
  });

  it("rejects collinear or too few points and reports residuals", () => {
    expect(rigidFromPairs([{ from: [0, 0, 0], to: [0, 0, 0] }, { from: [1, 0, 0], to: [1, 0, 0] }])).toBeNull();
    expect(rigidFromPairs([0, 1, 2].map((i) => ({ from: [i * 10, 0, 0] as Vec3, to: [i * 10, 0, 0] as Vec3 })))).toBeNull();
    const noisy = rigidFromPairs(pts.map((p, i) => ({ from: p, to: [p[0] + (i === 0 ? 3 : 0), p[1], p[2]] as Vec3 })))!;
    expect(noisy.rms).toBeGreaterThan(0.5);
  });

  it("alignByLandmark maps the moving landmark onto the base landmark and keeps the rotation", () => {
    const M = matrixFromParams({ ...IDENTITY_PARAMS, rz: 30 }, [0, 0, 0]);
    const out = alignByLandmark([10, 20, 30], [-5, 7, 100], M);
    const q = applyMat4(out, [-5, 7, 100]);
    expect(q[0]).toBeCloseTo(10, 9);
    expect(q[1]).toBeCloseTo(20, 9);
    expect(q[2]).toBeCloseTo(30, 9);
    for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) expect(out[i]).toBe(M[i]);
  });

  it("originShift moves the landmark to (0, 0, 0)", () => {
    const q = applyMat4(originShift([12, -3, 44]), [12, -3, 44]);
    expect(q.map((v) => Math.abs(v))).toEqual([0, 0, 0]);
  });

  it("taking a new origin into datasets keeps them aligned (moving dataset and base case)", () => {
    const g = (o: Vec3): VolumeGeometry => ({ origin: o, spacing: [2, 2, 3], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] });
    const items = [
      { id: "base", matrix: IDENTITY_MAT4, geometry: g([0, 0, 0]), landmarks: [{ name: "Nasenspitze", p: [40, -90, 20] as Vec3 }] },
      { id: "nii", matrix: matrixFromParams({ ...IDENTITY_PARAMS, tx: 100, rz: 90 }, [0, 0, 0]), geometry: g([-50, 20, 7]), landmarks: [{ name: "Nasenspitze", p: [3, 4, 5] as Vec3 }] },
      { id: "pet", matrix: matrixFromParams({ ...IDENTITY_PARAMS, ty: -30 }, [0, 0, 0]), geometry: g([10, 10, 10]) },
    ];
    const shown = (m: number[], geo: VolumeGeometry, v: Vec3) => applyMat4(m, voxelToWorld(geo, v[0], v[1], v[2]));
    for (const target of ["nii", "base"]) {
      const it = items.find((x) => x.id === target)!;
      const T = originShift(it.landmarks![0].p);
      const r = reorientPlan(items, new Set([target]), T, "base");
      const Winv = invert4(r.world);
      for (const x of items) {
        const before = shown(x.matrix, x.geometry, [3, 5, 7]);
        const after = applyMat4(Winv, shown(r.matrices.get(x.id)!, r.geometries.get(x.id) ?? x.geometry, [3, 5, 7]));
        for (let a = 0; a < 3; a++) expect(after[a]).toBeCloseTo(before[a], 6);
      }
      expect(r.landmarks.get(target)![0].p.map((v) => Math.abs(v) < 1e-9)).toEqual([true, true, true]);
    }
    // The base stays at the identity placement when it is the target.
    const rb = reorientPlan(items, new Set(["base"]), originShift([40, -90, 20]), "base");
    expect(rb.matrices.get("base")!.map((v, i) => Math.abs(v - IDENTITY_MAT4[i]) < 1e-9).every(Boolean)).toBe(true);
  });

  it("derived frame of reference UIDs are valid, deterministic and differ by transform", () => {
    const a = derivedFrameOfReference("1.2.3", originShift([1, 2, 3]));
    expect(a).toMatch(/^2\.25\.[1-9][0-9]*$/);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(derivedFrameOfReference("1.2.3", originShift([1, 2, 3]))).toBe(a);
    expect(derivedFrameOfReference("1.2.3", originShift([1, 2, 4]))).not.toBe(a);
  });

  it("two landmarks: landmark 1 coincides and the direction to landmark 2 matches", () => {
    const truth = matrixFromParams({ ...IDENTITY_PARAMS, tx: 30, ty: -12, tz: 200, rz: 90, rx: 20 }, [0, 0, 0]);
    const m1: Vec3 = [10, 20, 30], m2: Vec3 = [10, 20, 130];
    const b1 = applyMat4(truth, m1), b2 = applyMat4(truth, m2);
    for (const start of [IDENTITY_MAT4, matrixFromParams({ ...IDENTITY_PARAMS, ry: 180 }, [0, 0, 0])]) {
      const M = alignTwoLandmarks(b1, b2, m1, m2, start)!;
      const q1 = applyMat4(M, m1), q2 = applyMat4(M, m2);
      for (let a = 0; a < 3; a++) {
        expect(q1[a]).toBeCloseTo(b1[a], 6);
        expect(q2[a]).toBeCloseTo(b2[a], 6);
      }
    }
  });
});
