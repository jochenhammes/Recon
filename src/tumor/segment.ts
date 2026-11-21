import { type Vec3, voxelToWorld } from "../core/geometry";
import { PEAK_RADIUS_MM, sphereMean } from "../edit/voi";
import type { Volume3D } from "../viewer/volume";

/**
 * Whole-body lesion segmentation for metabolic tumor volume (TMTV/MTV) on PET:
 * threshold → 26-connected components → per-lesion statistics. All thresholds are in SUV; the volume
 * holds raw values and `suvFactor` converts (SUV = raw × factor).
 */
export type ThresholdMethod =
  /** Fixed SUV (e.g. 4.0 or 2.5 for lymphoma, 3.0 for PSMA). */
  | { kind: "absolute"; suv: number }
  /** Per lesion: connected region ≥ percent·SUVmax around its maximum; lesions detected with `detectSuv`. */
  | { kind: "percentMax"; percent: number; detectSuv: number }
  /** Reference-based: a × SUVmean(liver) + b × SD(liver) (PERCIST: 1.5, 2). */
  | { kind: "liver"; a: number; b: number; liverMean: number; liverSd: number };

export interface SegmentOptions {
  method: ThresholdMethod;
  suvFactor: number;
  /** Lesions smaller than this are dropped (ml). */
  minVolumeMl: number;
  /** Voxels never part of a lesion (e.g. physiological uptake, manual exclusions). */
  exclude?: Uint8Array;
}

export interface Lesion {
  id: number;
  voxels: number;
  volumeMl: number;
  suvMax: number;
  suvMean: number;
  suvPeak: number;
  /** Total lesion glycolysis (FDG) / total lesion PSMA: volume × SUVmean (ml·SUV). */
  tlg: number;
  /** Center of mass (patient coordinates of the PET, mm). */
  centroid: Vec3;
  /** Voxel index of the maximum. */
  maxIndex: number;
  included: boolean;
  /** Checked by the reader (confirmed = included, rejected = excluded). */
  reviewed?: boolean;
  /** Why the lesion is excluded (automatic), if so. */
  note?: string;
  /** Dominant CT organ (> 50 % of the voxels), if organ labels are available. */
  organ?: string;
  /** Mainly in bone (skeleton labels). */
  bone?: boolean;
}

export interface TumorSegmentation {
  /** Lesion id per voxel (0 = none), on the PET grid. */
  labels: Int32Array;
  lesions: Lesion[];
  /** Effective SUV threshold (for absolute/liver methods). */
  thresholdSuv: number | null;
  description: string;
}

/** Lesion SUV threshold of a method (null for the per-lesion relative method). */
export function methodThreshold(m: ThresholdMethod): number | null {
  if (m.kind === "absolute") return m.suv;
  if (m.kind === "liver") return m.a * m.liverMean + m.b * m.liverSd;
  return null;
}

export function describeMethod(m: ThresholdMethod): string {
  if (m.kind === "absolute") return `SUV ≥ ${m.suv}`;
  if (m.kind === "liver") return `SUV ≥ ${m.a} × Leber-Mittel + ${m.b} × SD = ${(m.a * m.liverMean + m.b * m.liverSd).toFixed(2)}`;
  return `${Math.round(m.percent * 100)} % SUVmax je Läsion (Detektion SUV ≥ ${m.detectSuv})`;
}

const NEIGHBORS: [number, number, number][] = [];
for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) NEIGHBORS.push([dx, dy, dz]);

/**
 * 26-connected components of `inside(i)` (flood fill with an explicit stack). Writes component ids
 * (starting at `firstId`) into `labels` where it is 0; returns the number of components.
 */
export function connectedComponents(nx: number, ny: number, nz: number, inside: (i: number) => boolean, labels: Int32Array, firstId = 1): number {
  const plane = nx * ny;
  let id = firstId;
  let grow = new Int32Array(1 << 16);
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== 0 || !inside(start)) continue;
    let top = 0;
    grow[top++] = start;
    labels[start] = id;
    while (top > 0) {
      const v = grow[--top];
      const x = v % nx, y = Math.floor(v / nx) % ny, z = Math.floor(v / plane);
      for (const [dx, dy, dz] of NEIGHBORS) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
        const w = Z * plane + Y * nx + X;
        if (labels[w] !== 0 || !inside(w)) continue;
        labels[w] = id;
        if (top >= grow.length) {
          const bigger = new Int32Array(grow.length * 2);
          bigger.set(grow);
          grow = bigger;
        }
        grow[top++] = w;
      }
    }
    id++;
  }
  return id - firstId;
}

/** Statistics of every lesion id in `labels` (ids 1…max), in SUV. Lesions keep `included` from `previous`. */
export function lesionStats(volume: Volume3D, labels: Int32Array, suvFactor: number, previous?: Lesion[]): Lesion[] {
  const { nx, ny, data } = volume;
  const plane = nx * ny;
  const [sx, sy, sz] = volume.geometry.spacing;
  const voxelMl = (sx * sy * sz) / 1000;
  const acc = new Map<number, { n: number; sum: number; max: number; maxIndex: number; cx: number; cy: number; cz: number }>();
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (id <= 0) continue;
    const v = data[i];
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { n: 0, sum: 0, max: -Infinity, maxIndex: i, cx: 0, cy: 0, cz: 0 }));
    a.n++;
    if (Number.isFinite(v)) {
      a.sum += v;
      if (v > a.max) {
        a.max = v;
        a.maxIndex = i;
      }
    }
    a.cx += i % nx;
    a.cy += Math.floor(i / nx) % ny;
    a.cz += Math.floor(i / plane);
  }
  // SUVpeak candidates: voxels ≥ 90 % of the lesion maximum (up to 4096 per lesion, evenly thinned).
  const cand = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (id <= 0) continue;
    const a = acc.get(id)!;
    if (!(data[i] >= 0.9 * a.max)) continue;
    let c = cand.get(id);
    if (!c) cand.set(id, (c = []));
    if (c.length < 4096) c.push(i);
  }
  const peakOf = (id: number, a: { maxIndex: number }) => {
    const c = cand.get(id) ?? [a.maxIndex];
    const step = Math.max(1, Math.floor(c.length / 48));
    let best = -Infinity;
    for (let t = 0; t < c.length; t += step) best = Math.max(best, sphereMean(volume, c[t], PEAK_RADIUS_MM));
    return Math.max(best, sphereMean(volume, a.maxIndex, PEAK_RADIUS_MM));
  };
  const prev = new Map((previous ?? []).map((l) => [l.id, l]));
  const out: Lesion[] = [];
  for (const [id, a] of [...acc].sort((p, q) => p[0] - q[0])) {
    const mean = (a.sum / a.n) * suvFactor;
    const volumeMl = a.n * voxelMl;
    out.push({
      id,
      voxels: a.n,
      volumeMl,
      suvMax: a.max * suvFactor,
      suvMean: mean,
      suvPeak: peakOf(id, a) * suvFactor,
      tlg: volumeMl * mean,
      centroid: voxelToWorld(volume.geometry, a.cx / a.n, a.cy / a.n, a.cz / a.n),
      maxIndex: a.maxIndex,
      included: prev.get(id)?.included ?? true,
      reviewed: prev.get(id)?.reviewed,
      note: prev.get(id)?.note,
      organ: prev.get(id)?.organ,
      bone: prev.get(id)?.bone,
    });
  }
  return out;
}

/** Threshold segmentation of the whole PET. */
export function segmentLesions(volume: Volume3D, opts: SegmentOptions): TumorSegmentation {
  const { nx, ny, nz, data } = volume;
  const f = opts.suvFactor;
  const ex = opts.exclude;
  const labels = new Int32Array(nx * ny * nz);
  const m = opts.method;
  if (m.kind === "percentMax") {
    // 1) Detection: components above the detection threshold.
    const detect = new Int32Array(labels.length);
    const raw = m.detectSuv / f;
    const n = connectedComponents(nx, ny, nz, (i) => data[i] >= raw && !(ex && ex[i]), detect);
    // 2) Per detected lesion (hottest first): region ≥ percent·max grown from its maximum.
    const maxima: { id: number; index: number; value: number }[] = [];
    for (let i = 0; i < detect.length; i++) {
      const id = detect[i];
      if (!id) continue;
      const cur = maxima[id - 1];
      if (!cur || data[i] > cur.value) maxima[id - 1] = { id, index: i, value: data[i] };
    }
    maxima.sort((a, b) => b.value - a.value);
    let next = 1;
    const plane = nx * ny;
    const stack: number[] = [];
    for (const mx of maxima.slice(0, n)) {
      if (!mx || labels[mx.index]) continue;
      const thr = m.percent * mx.value;
      stack.length = 0;
      stack.push(mx.index);
      labels[mx.index] = next;
      while (stack.length) {
        const v = stack.pop()!;
        const x = v % nx, y = Math.floor(v / nx) % ny, z = Math.floor(v / plane);
        for (const [dx, dy, dz] of NEIGHBORS) {
          const X = x + dx, Y = y + dy, Z = z + dz;
          if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
          const w = Z * plane + Y * nx + X;
          if (labels[w] || !(data[w] >= thr) || (ex && ex[w])) continue;
          labels[w] = next;
          stack.push(w);
        }
      }
      next++;
    }
  } else {
    const raw = methodThreshold(m)! / f;
    connectedComponents(nx, ny, nz, (i) => data[i] >= raw && !(ex && ex[i]), labels);
  }
  let lesions = lesionStats(volume, labels, f);
  // Minimum volume: drop tiny components (noise) and renumber.
  const keep = new Map<number, number>();
  lesions = lesions.filter((l) => l.volumeMl >= opts.minVolumeMl);
  lesions.forEach((l, i) => keep.set(l.id, i + 1));
  for (let i = 0; i < labels.length; i++) if (labels[i]) labels[i] = keep.get(labels[i]) ?? 0;
  lesions = lesions.map((l) => ({ ...l, id: keep.get(l.id)! }));
  return { labels, lesions, thresholdSuv: methodThreshold(m), description: describeMethod(m) };
}

/** Removes a lesion from the labels (e.g. excluded by brush) — returns a new label array. */
export function clearLabel(labels: Int32Array, id: number): Int32Array {
  const out = Int32Array.from(labels);
  for (let i = 0; i < out.length; i++) if (out[i] === id) out[i] = 0;
  return out;
}

/**
 * Removes all excluded lesions from the label image and renumbers the remaining ones 1…n in the given order
 * (e.g. by SUVmax). Returns the new label image and lesions.
 */
export function cleanupLesions(labels: Int32Array, lesions: Lesion[], order: (a: Lesion, b: Lesion) => number): { labels: Int32Array; lesions: Lesion[] } {
  const kept = lesions.filter((l) => l.included).sort(order);
  const map = new Map(kept.map((l, i) => [l.id, i + 1]));
  const out = new Int32Array(labels.length);
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (id) out[i] = map.get(id) ?? 0;
  }
  return { labels: out, lesions: kept.map((l) => ({ ...l, id: map.get(l.id)! })) };
}

export interface GrowOptions {
  /** Boundary as a fraction of the lesion maximum (e.g. 0.4). */
  fraction: number;
  /** Search radius around the seed for the lesion maximum (mm). */
  searchMm?: number;
  /** The region never extends farther than this from the maximum (mm) – guards against leaking into organs. */
  maxRadiusMm?: number;
  /** Voxels that already belong to a lesion (not taken over). */
  occupied?: Int32Array;
}

/**
 * Manual lesion from a seed point (crosshair): the maximum within `searchMm` of the seed, then 3D region growing
 * (26-neighbourhood) over voxels ≥ fraction × maximum, connected to the maximum, within `maxRadiusMm`.
 * Returns the voxel indices, or null when there is no activity near the seed.
 */
export function growLesion(volume: Volume3D, seed: [number, number, number], o: GrowOptions): { voxels: number[]; max: number; maxIndex: number; threshold: number } | null {
  const { nx, ny, nz, data } = volume;
  const [sx, sy, sz] = volume.geometry.spacing;
  const search = o.searchMm ?? 10, maxR = o.maxRadiusMm ?? 60;
  const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  // Maximum near the seed.
  let max = -Infinity, mi = -1, mj = -1, mk = -1;
  const ri = Math.ceil(search / sx), rj = Math.ceil(search / sy), rk = Math.ceil(search / sz);
  for (let k = Math.max(0, seed[2] - rk); k <= Math.min(nz - 1, seed[2] + rk); k++)
    for (let j = Math.max(0, seed[1] - rj); j <= Math.min(ny - 1, seed[1] + rj); j++)
      for (let i = Math.max(0, seed[0] - ri); i <= Math.min(nx - 1, seed[0] + ri); i++) {
        const d2 = ((i - seed[0]) * sx) ** 2 + ((j - seed[1]) * sy) ** 2 + ((k - seed[2]) * sz) ** 2;
        if (d2 > search * search) continue;
        const v = data[idx(i, j, k)];
        if (v > max && !(o.occupied && o.occupied[idx(i, j, k)] > 0)) {
          max = v;
          mi = i;
          mj = j;
          mk = k;
        }
      }
  if (mi < 0 || !(max > 0)) return null;
  const threshold = o.fraction * max;
  const seen = new Uint8Array(data.length);
  const start = idx(mi, mj, mk);
  const queue = [start];
  seen[start] = 1;
  const voxels: number[] = [];
  while (queue.length) {
    const p = queue.pop()!;
    voxels.push(p);
    const i = p % nx, j = Math.floor(p / nx) % ny, k = Math.floor(p / (nx * ny));
    for (let dk = -1; dk <= 1; dk++)
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj, c = k + dk;
          if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
          const q = idx(a, b, c);
          if (seen[q]) continue;
          seen[q] = 1;
          if (data[q] < threshold || (o.occupied && o.occupied[q] > 0)) continue;
          if (((a - mi) * sx) ** 2 + ((b - mj) * sy) ** 2 + ((c - mk) * sz) ** 2 > maxR * maxR) continue;
          queue.push(q);
        }
  }
  return { voxels, max, maxIndex: start, threshold };
}
