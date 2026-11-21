import { labelsByCanonical } from "./labelMap";

/** Dice coefficient of two binary masks (1 if both are empty). */
export function dice(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let inter = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ? 1 : 0, y = b[i] ? 1 : 0;
    inter += x & y;
    sa += x;
    sb += y;
  }
  return sa + sb === 0 ? 1 : (2 * inter) / (sa + sb);
}

/** Surface voxels (6-neighbourhood) of a mask as world coordinates in mm (voxel spacing `sp`, x fastest). */
function surface(mask: Uint8Array, dims: [number, number, number], sp: [number, number, number]): Float32Array {
  const [nx, ny, nz] = dims;
  const pts: number[] = [];
  const at = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && mask[(z * ny + y) * nx + x] !== 0;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (!mask[(z * ny + y) * nx + x]) continue;
        if (!at(x - 1, y, z) || !at(x + 1, y, z) || !at(x, y - 1, z) || !at(x, y + 1, z) || !at(x, y, z - 1) || !at(x, y, z + 1)) pts.push(x * sp[0], y * sp[1], z * sp[2]);
      }
  return Float32Array.from(pts);
}

/** Distances from every point of `a` to the nearest point of `b` (brute force on a coarse bucket grid). */
function directedDistances(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length / 3);
  if (!b.length) return out.fill(Infinity);
  const cell = 8;
  const buckets = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < b.length; i += 3) {
    const k = key(b[i], b[i + 1], b[i + 2]);
    let l = buckets.get(k);
    if (!l) buckets.set(k, (l = []));
    l.push(i);
  }
  for (let i = 0, n = 0; i < a.length; i += 3, n++) {
    const [x, y, z] = [a[i], a[i + 1], a[i + 2]];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let best = Infinity;
    // Grow the search shell until a point is found and the shell is farther than the best distance.
    for (let r = 0; r < 64; r++) {
      for (let dz = -r; dz <= r; dz++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
            const l = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!l) continue;
            for (const j of l) {
              const d = (b[j] - x) ** 2 + (b[j + 1] - y) ** 2 + (b[j + 2] - z) ** 2;
              if (d < best) best = d;
            }
          }
      if (best < Infinity && Math.sqrt(best) <= r * cell) break;
    }
    out[n] = Math.sqrt(best);
  }
  return out;
}

export interface SurfaceMetrics {
  /** 95th percentile of the symmetric surface distances (mm). */
  hd95: number;
  /** Fraction of surface points within `tolerance` mm of the other surface (normalized surface Dice). */
  nsd: number;
}

/** HD95 and normalized surface Dice of two masks on the same grid. */
export function surfaceMetrics(a: Uint8Array, b: Uint8Array, dims: [number, number, number], spacing: [number, number, number], tolerance = 2): SurfaceMetrics {
  const sa = surface(a, dims, spacing), sb = surface(b, dims, spacing);
  if (!sa.length && !sb.length) return { hd95: 0, nsd: 1 };
  if (!sa.length || !sb.length) return { hd95: Infinity, nsd: 0 };
  const dab = directedDistances(sa, sb), dba = directedDistances(sb, sa);
  const all = Float32Array.from([...dab, ...dba]).sort();
  const hd95 = all[Math.min(all.length - 1, Math.floor(0.95 * all.length))];
  let within = 0;
  for (const d of dab) if (d <= tolerance) within++;
  for (const d of dba) if (d <= tolerance) within++;
  return { hd95, nsd: within / (dab.length + dba.length) };
}

export interface StructureScore {
  name: string;
  dice: number;
  hd95?: number;
  nsd?: number;
  /** Reference and predicted volume (voxels). */
  refVoxels: number;
  predVoxels: number;
}

/**
 * Per-structure comparison of a predicted and a reference label image on the same grid, matched by canonical
 * structure names (only names present in both label tables). Optional surface metrics.
 */
export function compareLabelMaps(
  pred: ArrayLike<number>,
  predLabels: Map<number, string> | Record<string, string>,
  ref: ArrayLike<number>,
  refLabels: Map<number, string> | Record<string, string>,
  opts: { dims?: [number, number, number]; spacing?: [number, number, number]; surface?: boolean; group?: boolean; only?: string[] } = {},
): StructureScore[] {
  const p = labelsByCanonical(predLabels, opts.group);
  const r = labelsByCanonical(refLabels, opts.group);
  const out: StructureScore[] = [];
  for (const [name, refIds] of r) {
    const predIds = p.get(name);
    if (!predIds || (opts.only && !opts.only.includes(name))) continue;
    const a = new Uint8Array(pred.length), b = new Uint8Array(ref.length);
    let pv = 0, rv = 0;
    for (let i = 0; i < pred.length; i++) {
      if (predIds.has(Math.round(pred[i]))) {
        a[i] = 1;
        pv++;
      }
      if (refIds.has(Math.round(ref[i]))) {
        b[i] = 1;
        rv++;
      }
    }
    if (!rv) continue;
    const s: StructureScore = { name, dice: dice(a, b), refVoxels: rv, predVoxels: pv };
    if (opts.surface && opts.dims && opts.spacing) Object.assign(s, surfaceMetrics(a, b, opts.dims, opts.spacing));
    out.push(s);
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}
