import { describe, expect, it } from "vitest";
import { type Vec3, type VolumeGeometry, voxelToWorld, worldToVoxel } from "../core/geometry";
import type { Mat4 } from "../core/transform";
import { Volume3D } from "../viewer/volume";
import { type GroupGeometryAction, groupEditFor, rotationSense } from "./groupGeometry";
import { applyEdit } from "./operations";

const I: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as Mat4;

function vol(dims: Vec3, g: VolumeGeometry, hot: Vec3): Volume3D {
  const [nx, ny, nz] = dims;
  const data = new Float32Array(nx * ny * nz);
  data[(hot[2] * ny + hot[1]) * nx + hot[0]] = 1;
  return new Volume3D(data, nz, ny, nx, [g.spacing[2], g.spacing[1], g.spacing[0]], g);
}

/** World position of the single hot voxel. */
function hotWorld(v: Volume3D): Vec3 {
  const i = v.data.indexOf(1);
  const x = i % v.nx, y = Math.floor(i / v.nx) % v.ny, z = Math.floor(i / (v.nx * v.ny));
  return voxelToWorld(v.geometry, x, y, z);
}

// Two datasets with different grids and fields of view; B runs right→left (x axis flipped).
const gA: VolumeGeometry = { origin: [0, 0, 0], spacing: [1, 1, 1], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
const gB: VolumeGeometry = { origin: [17, 4, 2], spacing: [2, 2, 2], axes: [[-1, 0, 0], [0, 1, 0], [0, 0, 1]] };
const dimsA: Vec3 = [20, 16, 12];
const dimsB: Vec3 = [6, 5, 4];
const center: Vec3 = voxelToWorld(gA, (dimsA[0] - 1) / 2, (dimsA[1] - 1) / 2, (dimsA[2] - 1) / 2);

function run(action: GroupGeometryAction) {
  const p: Vec3 = [9, 6, 4]; // world point lying on voxel centers of both grids
  const out: Vec3[] = [];
  for (const [g, dims] of [[gA, dimsA], [gB, dimsB]] as const) {
    const v = worldToVoxel(g, p).map(Math.round) as Vec3;
    const op = groupEditFor({ geometry: g, dims, matrix: I }, action, center, "g1")!;
    out.push(hotWorld(applyEdit(vol(dims, g, v), op).volume));
  }
  return out;
}

describe("common geometry edit", () => {
  it("mirrors all datasets about the same plane", () => {
    const [a, b] = run({ kind: "flip", patientAxis: 0 });
    expect(a[0]).toBeCloseTo(2 * center[0] - 9, 6);
    for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k], 6);
  });

  it("rotates all datasets the same way about the same axis", () => {
    const sense = rotationSense({ geometry: gA, matrix: I });
    for (const turns of [1, 2, 3]) {
      const [a, b] = run({ kind: "rotate", turns, sense });
      for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k], 6);
      expect(a[2]).toBeCloseTo(4, 6);
    }
  });

  it("resamples label images with nearest neighbour", () => {
    const op = groupEditFor({ geometry: gA, dims: dimsA, matrix: I, labels: true }, { kind: "resample", spacing: [2, 2, 2] }, center, "g");
    expect(op).toMatchObject({ type: "resample", nearest: true });
    const lab = new Volume3D(Float32Array.from({ length: 20 * 16 * 12 }, (_, i) => (i % 2 ? 3 : 7)), 12, 16, 20, [1, 1, 1], gA);
    const r = applyEdit(lab, op!).volume;
    for (const v of new Set(r.data)) expect([3, 7]).toContain(v);
  });
});
