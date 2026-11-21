import { type Vec3, voxelToWorld } from "../core/geometry";
import { applyMat4 } from "../core/transform";
import type { Placed } from "./dose";

/**
 * Lesions across time points: centroids of the lesion labels in the common (registered) world and an optimal
 * one-to-one assignment by distance (Hungarian method) with a maximum distance.
 */

export interface Centroid {
  center: Vec3;
  voxels: number;
}

/** Centroid (world, after the placement matrix) and size of every non-zero label of a label image. */
export function labelCentroids(l: Placed, only?: Set<number>): Map<number, Centroid> {
  const { nx, ny, nz, data } = l.volume;
  const acc = new Map<number, [number, number, number, number]>();
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const id = Math.round(data[(k * ny + j) * nx + i]);
        if (!id || (only && !only.has(id))) continue;
        let a = acc.get(id);
        if (!a) acc.set(id, (a = [0, 0, 0, 0]));
        a[0] += i;
        a[1] += j;
        a[2] += k;
        a[3]++;
      }
  const out = new Map<number, Centroid>();
  for (const [id, [si, sj, sk, n]] of acc) out.set(id, { center: applyMat4(l.matrix, voxelToWorld(l.volume.geometry, si / n, sj / n, sk / n)), voxels: n });
  return out;
}

/** Minimum-cost assignment of a rectangular cost matrix (rows → column or −1), Hungarian method O(n³). */
export function hungarian(cost: number[][]): number[] {
  const rows = cost.length, cols = rows ? cost[0].length : 0;
  const n = Math.max(rows, cols);
  if (!n) return [];
  const BIG = 1e12;
  const a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i < rows && j < cols ? cost[i][j] : BIG)));
  // Potentials formulation (1-indexed), see e.g. e-maxx "Hungarian algorithm".
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity), used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++)
        if (!used[j]) {
          const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      for (let j = 0; j <= n; j++)
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const res = new Array(rows).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] && p[j] - 1 < rows && j - 1 < cols && a[p[j] - 1][j - 1] < BIG) res[p[j] - 1] = j - 1;
  return res;
}

export interface LesionMatch {
  refId: number;
  otherId: number | null;
  distMm?: number;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Optimal pairing of reference lesions with the lesions of another time point; pairs farther than `maxMm` stay unmatched. */
export function matchLesions(ref: Map<number, Centroid>, other: Map<number, Centroid>, maxMm: number): LesionMatch[] {
  const r = [...ref.keys()].sort((x, y) => x - y), o = [...other.keys()].sort((x, y) => x - y);
  // Pairs beyond the limit get a cost above any admissible assignment, so they are never preferred.
  const penalty = maxMm * 1e3;
  const cost = r.map((ri) => o.map((oi) => {
    const d = dist(ref.get(ri)!.center, other.get(oi)!.center);
    return d <= maxMm ? d : penalty + d;
  }));
  const assign = hungarian(cost);
  return r.map((ri, i) => {
    const j = assign[i];
    if (j < 0) return { refId: ri, otherId: null };
    const d = dist(ref.get(ri)!.center, other.get(o[j])!.center);
    return d <= maxMm ? { refId: ri, otherId: o[j], distMm: d } : { refId: ri, otherId: null };
  });
}
