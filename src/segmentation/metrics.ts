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

/** Surface voxels (6-neighbourhood) of a mask (x fastest). */
function surface(mask: Uint8Array, dims: [number, number, number]): Uint8Array {
  const [nx, ny, nz] = dims;
  const out = new Uint8Array(mask.length);
  const at = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && mask[(z * ny + y) * nx + x] !== 0;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = (z * ny + y) * nx + x;
        if (mask[i] && (!at(x - 1, y, z) || !at(x + 1, y, z) || !at(x, y - 1, z) || !at(x, y + 1, z) || !at(x, y, z - 1) || !at(x, y, z + 1))) out[i] = 1;
      }
  return out;
}

/** 1-D squared distance transform (Felzenszwalb & Huttenlocher) of f with sample distance `h` (in place via `d`). */
function edt1d(f: Float64Array, n: number, h: number, d: Float64Array, v: Int32Array, zb: Float64Array) {
  let k = 0;
  v[0] = 0;
  zb[0] = -Infinity;
  zb[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (f[q] === Infinity) continue;
    if (f[v[k]] === Infinity) {
      v[k] = q;
      continue;
    }
    let s: number;
    for (;;) {
      const p = v[k];
      s = (f[q] + (q * h) ** 2 - (f[p] + (p * h) ** 2)) / (2 * h * (q - p));
      if (s <= zb[k] && k > 0) k--;
      else break;
    }
    k++;
    v[k] = q;
    zb[k] = s;
    zb[k + 1] = Infinity;
  }
  if (f[v[0]] === Infinity) {
    d.fill(Infinity, 0, n);
    return;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (zb[k + 1] < q * h) k++;
    d[q] = (q - v[k]) ** 2 * h * h + f[v[k]];
  }
}

/** Exact Euclidean distance (mm) of every voxel to the nearest set voxel of `mask` (anisotropic spacing). */
export function distanceMap(mask: Uint8Array, dims: [number, number, number], sp: [number, number, number]): Float64Array {
  const [nx, ny, nz] = dims;
  const g = new Float64Array(mask.length);
  for (let i = 0; i < g.length; i++) g[i] = mask[i] ? 0 : Infinity;
  const m = Math.max(nx, ny, nz);
  const f = new Float64Array(m), d = new Float64Array(m), zb = new Float64Array(m + 1);
  const v = new Int32Array(m);
  const pass = (n: number, h: number, index: (t: number) => number, lines: number, base: (l: number) => number) => {
    for (let l = 0; l < lines; l++) {
      const b = base(l);
      for (let t = 0; t < n; t++) f[t] = g[b + index(t)];
      edt1d(f, n, h, d, v, zb);
      for (let t = 0; t < n; t++) g[b + index(t)] = d[t];
    }
  };
  pass(nx, sp[0], (t) => t, ny * nz, (l) => l * nx);
  pass(ny, sp[1], (t) => t * nx, nx * nz, (l) => (l % nx) + Math.floor(l / nx) * nx * ny);
  pass(nz, sp[2], (t) => t * nx * ny, nx * ny, (l) => l);
  for (let i = 0; i < g.length; i++) g[i] = Math.sqrt(g[i]);
  return g;
}

export interface SurfaceMetrics {
  /** 95th percentile of the symmetric surface distances (mm). */
  hd95: number;
  /** Fraction of surface points within `tolerance` mm of the other surface (normalized surface Dice). */
  nsd: number;
}

/** HD95 and normalized surface Dice of two masks on the same grid. */
export function surfaceMetrics(a: Uint8Array, b: Uint8Array, dims: [number, number, number], spacing: [number, number, number], tolerance = 2): SurfaceMetrics {
  const sa = surface(a, dims), sb = surface(b, dims);
  const na = sa.reduce((s, x) => s + x, 0), nb = sb.reduce((s, x) => s + x, 0);
  if (!na && !nb) return { hd95: 0, nsd: 1 };
  if (!na || !nb) return { hd95: Infinity, nsd: 0 };
  const da = distanceMap(sa, dims, spacing), db = distanceMap(sb, dims, spacing);
  const all = new Float64Array(na + nb);
  let k = 0, within = 0;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i]) {
      all[k++] = db[i];
      if (db[i] <= tolerance) within++;
    }
    if (sb[i]) {
      all[k++] = da[i];
      if (da[i] <= tolerance) within++;
    }
  }
  all.sort();
  return { hd95: all[Math.min(all.length - 1, Math.floor(0.95 * all.length))], nsd: within / all.length };
}

/** Both masks cropped to the bounding box of their union (+1 voxel), so surface metrics on large grids stay cheap. */
function cropToUnion(a: Uint8Array, b: Uint8Array, dims: [number, number, number]) {
  const [nx, ny] = dims;
  const lo = [Infinity, Infinity, Infinity], hi = [-1, -1, -1];
  for (let i = 0; i < a.length; i++) {
    if (!a[i] && !b[i]) continue;
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
    const p = [x, y, z];
    for (let k = 0; k < 3; k++) {
      if (p[k] < lo[k]) lo[k] = p[k];
      if (p[k] > hi[k]) hi[k] = p[k];
    }
  }
  if (hi[0] < 0) return { a, b, dims };
  for (let k = 0; k < 3; k++) {
    lo[k] = Math.max(0, lo[k] - 1);
    hi[k] = Math.min(dims[k] - 1, hi[k] + 1);
  }
  const d: [number, number, number] = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
  const ca = new Uint8Array(d[0] * d[1] * d[2]), cb = new Uint8Array(ca.length);
  let o = 0;
  for (let z = lo[2]; z <= hi[2]; z++)
    for (let y = lo[1]; y <= hi[1]; y++)
      for (let x = lo[0]; x <= hi[0]; x++, o++) {
        const i = (z * ny + y) * nx + x;
        ca[o] = a[i];
        cb[o] = b[i];
      }
  return { a: ca, b: cb, dims: d };
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
  opts: { dims?: [number, number, number]; spacing?: [number, number, number]; surface?: boolean; tolerance?: number; group?: boolean; only?: string[] } = {},
): StructureScore[] {
  const p = labelsByCanonical(predLabels, opts.group);
  const r = labelsByCanonical(refLabels, opts.group);
  const names = [...r.keys()].filter((n) => p.has(n) && (!opts.only || opts.only.includes(n)));
  // Label value → structure index (+1), one pass for all overlaps.
  const lut = (m: Map<string, Set<number>>) => {
    const t = new Map<number, number>();
    names.forEach((n, k) => m.get(n)!.forEach((id) => t.set(id, k + 1)));
    return t;
  };
  const pl = lut(p), rl = lut(r);
  const pv = new Float64Array(names.length + 1), rv = new Float64Array(names.length + 1), both = new Float64Array(names.length + 1);
  for (let i = 0; i < pred.length; i++) {
    const a = pl.get(Math.round(pred[i])) ?? 0, b = rl.get(Math.round(ref[i])) ?? 0;
    pv[a]++;
    rv[b]++;
    if (a && a === b) both[a]++;
  }
  const out: StructureScore[] = [];
  names.forEach((name, k) => {
    if (!rv[k + 1]) return;
    const s: StructureScore = { name, dice: (2 * both[k + 1]) / (pv[k + 1] + rv[k + 1]), refVoxels: rv[k + 1], predVoxels: pv[k + 1] };
    if (opts.surface && opts.dims && opts.spacing) {
      const a = new Uint8Array(pred.length), b = new Uint8Array(ref.length);
      for (let i = 0; i < pred.length; i++) {
        a[i] = pl.get(Math.round(pred[i])) === k + 1 ? 1 : 0;
        b[i] = rl.get(Math.round(ref[i])) === k + 1 ? 1 : 0;
      }
      const c = cropToUnion(a, b, opts.dims);
      Object.assign(s, surfaceMetrics(c.a, c.b, c.dims, opts.spacing, opts.tolerance));
    }
    out.push(s);
  });
  return out.sort((x, y) => x.name.localeCompare(y.name));
}
