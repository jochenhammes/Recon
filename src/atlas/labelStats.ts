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

/**
 * Most frequent label per voxel over several samples (e.g. s³ points inside each voxel of a coarser grid); ties go
 * to the label seen first. Background (0) counts like a label, so region borders do not grow.
 */
export function majorityLabels(samples: Float32Array[]): Float32Array {
  const n = samples[0]?.length ?? 0;
  const out = new Float32Array(n);
  const m = samples.length;
  const vals = new Float64Array(m), cnt = new Int32Array(m);
  for (let i = 0; i < n; i++) {
    let u = 0;
    for (let s = 0; s < m; s++) {
      const v = Math.round(samples[s][i]);
      let k = 0;
      while (k < u && vals[k] !== v) k++;
      if (k === u) {
        vals[u] = v;
        cnt[u++] = 1;
      } else cnt[k]++;
    }
    let best = 0;
    for (let k = 1; k < u; k++) if (cnt[k] > cnt[best]) best = k;
    out[i] = vals[best];
  }
  return out;
}

/** Sub-sample offsets (voxel units, centred) for an s×s×s grid inside a voxel. */
export function subVoxelOffsets(s: number): [number, number, number][] {
  const o = Array.from({ length: s }, (_, q) => (q + 0.5) / s - 0.5);
  const out: [number, number, number][] = [];
  for (const z of o) for (const y of o) for (const x of o) out.push([x, y, z]);
  return out;
}
