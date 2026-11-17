import { type Vec3, applyWorldToVoxel, voxelToWorld } from "../core/geometry";
import { applyMat4 } from "../core/transform";
import type { OverviewRow, OverviewVoi } from "../components/DatasetOverview";

/**
 * The VOI transferred onto another dataset's grid through the registration: each target voxel (within the
 * VOI's world bounding box) takes the mask value of the nearest voxel of the source grid.
 */
export function transferVoi(voi: OverviewVoi, target: OverviewRow): { mask: Uint8Array; bounds: { min: Vec3; max: Vec3 } } | null {
  const src = voi.volume;
  const b = voi.bounds ?? { min: [0, 0, 0] as Vec3, max: [src.nx - 1, src.ny - 1, src.nz - 1] as Vec3 };
  // Source VOI box corners → reference world (inverse of the source w2v) → target voxel box.
  const toWorld = (p: Vec3): Vec3 => {
    // Solve m·(w − o) = p for w using the inverse via Cramer's rule on the 3×3 m.
    const m = voi.w2v.m;
    const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    const inv = [
      (m[4] * m[8] - m[5] * m[7]) / det, (m[2] * m[7] - m[1] * m[8]) / det, (m[1] * m[5] - m[2] * m[4]) / det,
      (m[5] * m[6] - m[3] * m[8]) / det, (m[0] * m[8] - m[2] * m[6]) / det, (m[2] * m[3] - m[0] * m[5]) / det,
      (m[3] * m[7] - m[4] * m[6]) / det, (m[1] * m[6] - m[0] * m[7]) / det, (m[0] * m[4] - m[1] * m[3]) / det,
    ];
    const o = voi.w2v.origin;
    return [o[0] + inv[0] * p[0] + inv[1] * p[1] + inv[2] * p[2], o[1] + inv[3] * p[0] + inv[4] * p[1] + inv[5] * p[2], o[2] + inv[6] * p[0] + inv[7] * p[1] + inv[8] * p[2]];
  };
  const t = target.volume;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [b.min[0] - 0.5, b.max[0] + 0.5])
    for (const y of [b.min[1] - 0.5, b.max[1] + 0.5])
      for (const z of [b.min[2] - 0.5, b.max[2] + 0.5]) {
        const v = applyWorldToVoxel(target.w2v, toWorld([x, y, z]));
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], v[a]);
          hi[a] = Math.max(hi[a], v[a]);
        }
      }
  const dims: Vec3 = [t.nx, t.ny, t.nz];
  const min = lo.map((v) => Math.max(0, Math.floor(v))) as Vec3;
  const max = hi.map((v, a) => Math.min(dims[a] - 1, Math.ceil(v))) as Vec3;
  if (min.some((v, a) => v > max[a])) return null;
  const mask = new Uint8Array(t.nx * t.ny * t.nz);
  for (let k = min[2]; k <= max[2]; k++)
    for (let j = min[1]; j <= max[1]; j++)
      for (let i = min[0]; i <= max[0]; i++) {
        const w = applyMat4(target.matrix, voxelToWorld(t.geometry, i, j, k));
        const [x, y, z] = applyWorldToVoxel(voi.w2v, w).map(Math.round);
        if (x < 0 || y < 0 || z < 0 || x >= src.nx || y >= src.ny || z >= src.nz) continue;
        if (voi.mask[(z * src.ny + y) * src.nx + x]) mask[(k * t.ny + j) * t.nx + i] = 1;
      }
  return { mask, bounds: { min, max } };
}
