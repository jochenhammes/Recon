import { type Vec3, voxelToWorld } from "../core/geometry";
import type { Volume3D } from "../viewer/volume";

export interface LabelStat {
  id: number;
  voxels: number;
  volumeMl: number;
  /** Center of mass in the label volume's own patient coordinates (mm). */
  centroid: Vec3;
}

const cache = new WeakMap<Float32Array, Map<number, LabelStat>>();

/** Voxel count, volume and centroid of every label present in a label image (cached per data array). */
export function labelStats(vol: Volume3D): Map<number, LabelStat> {
  const hit = cache.get(vol.data);
  if (hit) return hit;
  const { nx, ny, data } = vol;
  const acc = new Map<number, { n: number; x: number; y: number; z: number }>();
  for (let i = 0; i < data.length; i++) {
    const l = Math.round(data[i]);
    if (!(l > 0)) continue;
    let a = acc.get(l);
    if (!a) acc.set(l, (a = { n: 0, x: 0, y: 0, z: 0 }));
    a.n++;
    a.x += i % nx;
    a.y += Math.floor(i / nx) % ny;
    a.z += Math.floor(i / (nx * ny));
  }
  const [sx, sy, sz] = vol.geometry.spacing;
  const out = new Map<number, LabelStat>();
  for (const [id, a] of acc)
    out.set(id, { id, voxels: a.n, volumeMl: (a.n * sx * sy * sz) / 1000, centroid: voxelToWorld(vol.geometry, a.x / a.n, a.y / a.n, a.z / a.n) });
  cache.set(vol.data, out);
  return out;
}

const filterCache = new WeakMap<Float32Array, { key: string; vol: Volume3D }>();

/** Label image with only the given labels kept (others 0); cached for the last filter per volume. */
export function filteredLabels(vol: Volume3D, keep: number[]): Volume3D {
  const key = [...keep].sort((a, b) => a - b).join(",");
  const hit = filterCache.get(vol.data);
  if (hit && hit.key === key) return hit.vol;
  const set = new Set(keep);
  const data = new Float32Array(vol.data.length);
  for (let i = 0; i < data.length; i++) {
    const l = Math.round(vol.data[i]);
    if (l > 0 && set.has(l)) data[i] = vol.data[i];
  }
  const out = vol.withData(data);
  filterCache.set(vol.data, { key, vol: out });
  return out;
}
