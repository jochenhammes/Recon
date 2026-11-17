import { type Vec3, type WorldToVoxel, applyWorldToVoxel, voxelToWorld, worldToVoxelTransform } from "../core/geometry";
import type { VoxelGrid } from "./types";

/** Orthogonal display planes in patient (LPS) space. */
export type PlaneKind = "axial" | "coronal" | "sagittal";

/**
 * Axis-aligned world-space box shown in all views, sampled with square pixels of `pixel` mm.
 * Display conventions (radiological): axial — anterior up, patient right on image left;
 * coronal — head up, patient right on image left; sagittal — head up, anterior on image left.
 */
export interface DisplayGrid {
  min: Vec3;
  max: Vec3;
  pixel: number;
}

/** Maps output pixel (u, v) to world: world = origin + u·U + v·V. */
export interface PlaneBasis {
  kind: PlaneKind;
  origin: Vec3;
  U: Vec3;
  V: Vec3;
  width: number;
  height: number;
}

const MAX_DISPLAY_PIXELS = 1024;

/** World bounding box (voxel corners) of a volume. */
export function volumeBounds(volume: VoxelGrid): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const i of [-0.5, volume.nx - 0.5])
    for (const j of [-0.5, volume.ny - 0.5])
      for (const k of [-0.5, volume.nz - 0.5]) {
        const p = voxelToWorld(volume.geometry, i, j, k);
        for (let a = 0; a < 3; a++) {
          if (p[a] < min[a]) min[a] = p[a];
          if (p[a] > max[a]) max[a] = p[a];
        }
      }
  return { min, max };
}

/** Display grid covering all volumes, with the finest voxel size (limited to ~1024 px per side). */
export function computeDisplayGrid(volumes: VoxelGrid[]): DisplayGrid {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let finest = Infinity;
  for (const v of volumes) {
    const b = volumeBounds(v);
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], b.min[a]);
      max[a] = Math.max(max[a], b.max[a]);
    }
    finest = Math.min(finest, ...v.geometry.spacing);
  }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  return { min, max, pixel: Math.max(finest, extent / MAX_DISPLAY_PIXELS) };
}

/** Plane at world coordinate `coord` along the view's normal axis. Pixel centers lie inside the grid box. */
export function planeBasis(grid: DisplayGrid, kind: PlaneKind, coord: number): PlaneBasis {
  const p = grid.pixel;
  const { min, max } = grid;
  const n = (a: number) => Math.max(1, Math.round((max[a] - min[a]) / p));
  const half = p / 2;
  switch (kind) {
    case "axial":
      return { kind, origin: [min[0] + half, min[1] + half, coord], U: [p, 0, 0], V: [0, p, 0], width: n(0), height: n(1) };
    case "coronal":
      return { kind, origin: [min[0] + half, coord, max[2] - half], U: [p, 0, 0], V: [0, 0, -p], width: n(0), height: n(2) };
    case "sagittal":
      return { kind, origin: [coord, min[1] + half, max[2] - half], U: [0, p, 0], V: [0, 0, -p], width: n(1), height: n(2) };
  }
}

/** Continuous pixel coordinates (u, v) of a world point projected onto the plane. */
export function worldToPlane(b: PlaneBasis, w: Vec3): [number, number] {
  const d: Vec3 = [w[0] - b.origin[0], w[1] - b.origin[1], w[2] - b.origin[2]];
  const uu = b.U[0] * b.U[0] + b.U[1] * b.U[1] + b.U[2] * b.U[2];
  const vv = b.V[0] * b.V[0] + b.V[1] * b.V[1] + b.V[2] * b.V[2];
  return [(d[0] * b.U[0] + d[1] * b.U[1] + d[2] * b.U[2]) / uu, (d[0] * b.V[0] + d[1] * b.V[1] + d[2] * b.V[2]) / vv];
}

export function planeToWorld(b: PlaneBasis, u: number, v: number): Vec3 {
  return [
    b.origin[0] + u * b.U[0] + v * b.V[0],
    b.origin[1] + u * b.U[1] + v * b.V[1],
    b.origin[2] + u * b.U[2] + v * b.V[2],
  ];
}

/** Index of the world axis the plane is perpendicular to (axial → z, coronal → y, sagittal → x). */
export function planeNormalAxis(kind: PlaneKind): 0 | 1 | 2 {
  return kind === "axial" ? 2 : kind === "coronal" ? 1 : 0;
}

/** Orientation letters [top, bottom, left, right] for each view. */
export function orientationLabels(kind: PlaneKind): [string, string, string, string] {
  switch (kind) {
    case "axial":
      return ["A", "P", "R", "L"];
    case "coronal":
      return ["H", "F", "R", "L"];
    case "sagittal":
      return ["H", "F", "A", "P"];
  }
}

/**
 * Samples a volume on a plane with trilinear interpolation. Points outside the volume become NaN
 * (rendered transparent). `w2v` maps world to continuous voxel index (may include registration).
 */
export function samplePlane(volume: VoxelGrid, w2v: WorldToVoxel, b: PlaneBasis, out?: Float32Array, nearest = false): Float32Array {
  const { width, height } = b;
  const res = out && out.length === width * height ? out : new Float32Array(width * height);
  const { nx, ny, nz, data } = volume;
  const sliceSize = nx * ny;
  // Voxel coordinates are affine in (u, v): v0 + u·du + v·dv.
  const v0 = applyWorldToVoxel(w2v, b.origin);
  const pu = applyWorldToVoxel(w2v, [b.origin[0] + b.U[0], b.origin[1] + b.U[1], b.origin[2] + b.U[2]]);
  const pv = applyWorldToVoxel(w2v, [b.origin[0] + b.V[0], b.origin[1] + b.V[1], b.origin[2] + b.V[2]]);
  const du = [pu[0] - v0[0], pu[1] - v0[1], pu[2] - v0[2]];
  const dv = [pv[0] - v0[0], pv[1] - v0[1], pv[2] - v0[2]];
  const xMax = nx - 1;
  const yMax = ny - 1;
  const zMax = nz - 1;

  for (let v = 0; v < height; v++) {
    let x = v0[0] + v * dv[0];
    let y = v0[1] + v * dv[1];
    let z = v0[2] + v * dv[2];
    const row = v * width;
    for (let u = 0; u < width; u++, x += du[0], y += du[1], z += du[2]) {
      // Half-voxel tolerance so edge voxels are fully visible.
      if (x < -0.5 || y < -0.5 || z < -0.5 || x > xMax + 0.5 || y > yMax + 0.5 || z > zMax + 0.5) {
        res[row + u] = NaN;
        continue;
      }
      const cx = x < 0 ? 0 : x > xMax ? xMax : x;
      const cy = y < 0 ? 0 : y > yMax ? yMax : y;
      const cz = z < 0 ? 0 : z > zMax ? zMax : z;
      if (nearest) {
        res[row + u] = data[Math.round(cz) * sliceSize + Math.round(cy) * nx + Math.round(cx)];
        continue;
      }
      const x0 = Math.floor(cx);
      const y0 = Math.floor(cy);
      const z0 = Math.floor(cz);
      const x1 = x0 < xMax ? x0 + 1 : x0;
      const y1 = y0 < yMax ? y0 + 1 : y0;
      const z1 = z0 < zMax ? z0 + 1 : z0;
      const fx = cx - x0;
      const fy = cy - y0;
      const fz = cz - z0;
      const b00 = z0 * sliceSize + y0 * nx;
      const b01 = z0 * sliceSize + y1 * nx;
      const b10 = z1 * sliceSize + y0 * nx;
      const b11 = z1 * sliceSize + y1 * nx;
      const c00 = data[b00 + x0] + (data[b00 + x1] - data[b00 + x0]) * fx;
      const c01 = data[b01 + x0] + (data[b01 + x1] - data[b01 + x0]) * fx;
      const c10 = data[b10 + x0] + (data[b10 + x1] - data[b10 + x0]) * fx;
      const c11 = data[b11 + x0] + (data[b11 + x1] - data[b11 + x0]) * fx;
      const c0 = c00 + (c01 - c00) * fy;
      const c1 = c10 + (c11 - c10) * fy;
      res[row + u] = c0 + (c1 - c0) * fz;
    }
  }
  return res;
}

/** Nearest-voxel value at a world point, or NaN outside the volume. */
export function valueAt(volume: VoxelGrid, w2v: WorldToVoxel, p: Vec3): number {
  const [x, y, z] = applyWorldToVoxel(w2v, p).map(Math.round);
  if (x < 0 || y < 0 || z < 0 || x >= volume.nx || y >= volume.ny || z >= volume.nz) return NaN;
  return volume.data[(z * volume.ny + y) * volume.nx + x];
}

export { worldToVoxelTransform };
