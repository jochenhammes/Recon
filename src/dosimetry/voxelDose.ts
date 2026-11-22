import { fft, nextPow2 } from "../recon/fft";
import type { Volume3D } from "../viewer/volume";
import { type Placed, densityFromHu, trilinear, voxelMap, voxelMl } from "./dose";
import { DECAYS_PER_MBQH, J_PER_KEV } from "./nuclideData";
import type { DoseKernel } from "./setup";

import { t } from "../i18n";
/** One time point for the voxel dose: SPECT (counts) placed in the reference world, MBq per count, hours p.i. */
export interface VoxelTimePoint {
  spect: Placed;
  mbqPerCount: number;
  tH: number;
}

export interface VoxelDoseOptions {
  physHalfLifeH: number;
  electronKeV: number;
  method: "trapezoid" | "mono";
  /** CT of the reference time point for the density (else 1 g/ml). */
  ct?: Placed;
  /** Dose voxel kernel (Gy per MBq·s, water); replaces local deposition. */
  kernel?: DoseKernel;
  onProgress?: (f: number) => void;
}

const yieldUi = () => new Promise((r) => setTimeout(r, 0));

/**
 * Time-integrated activity per ml (MBq·h/ml) on the grid of `ref` (the reference SPECT): every time point is
 * sampled through the registration. Trapezoids from (0, 0) plus a mono-exponential tail from the last two
 * points (not slower than physical decay), or a log-linear mono-exponential fit; one point → Hänscheid.
 */
export async function voxelTia(ref: Placed, tps: VoxelTimePoint[], o: VoxelDoseOptions): Promise<Float32Array> {
  const sorted = [...tps].sort((a, b) => a.tH - b.tH);
  const n = sorted.length;
  const { nx, ny, nz } = ref.volume;
  const maps = sorted.map((tp) => voxelMap(ref, tp.spect));
  const conc = sorted.map((tp) => tp.mbqPerCount / voxelMl(tp.spect.volume));
  const t = sorted.map((tp) => tp.tH);
  const lPhys = Math.LN2 / o.physHalfLifeH;
  const out = new Float32Array(nx * ny * nz);
  const a = new Float64Array(n);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let any = false;
        for (let m = 0; m < n; m++) {
          const p = maps[m](i, j, k);
          a[m] = Math.max(0, trilinear(sorted[m].spect.volume, p[0], p[1], p[2]) * conc[m]);
          if (a[m] > 0) any = true;
        }
        if (!any) continue;
        out[(k * ny + j) * nx + i] = integrate(t, a, lPhys, o.method);
      }
    if (k % 4 === 3) {
      o.onProgress?.((k + 1) / nz);
      await yieldUi();
    }
  }
  return out;
}

/** TIA of one sampled curve (see voxelTia). */
export function integrate(t: number[], a: ArrayLike<number>, lPhys: number, method: "trapezoid" | "mono"): number {
  const n = t.length;
  if (n === 1) return (a[0] * 2 * t[0]) / Math.LN2; // Hänscheid
  if (method === "mono") {
    // Log-linear least squares over the points with activity; λ ≥ λ_phys.
    let s = 0, st = 0, sl = 0, stt = 0, stl = 0;
    for (let m = 0; m < n; m++) {
      if (!(a[m] > 0)) continue;
      const l = Math.log(a[m]);
      s++;
      st += t[m];
      sl += l;
      stt += t[m] * t[m];
      stl += t[m] * l;
    }
    if (s >= 2) {
      const den = s * stt - st * st;
      const slope = den > 0 ? (s * stl - st * sl) / den : -lPhys;
      const lam = Math.max(-slope, lPhys);
      const a0 = Math.exp((sl + lam * st) / s);
      return a0 / lam;
    }
  }
  let area = (a[0] / 2) * t[0];
  for (let m = 1; m < n; m++) area += ((a[m] + a[m - 1]) / 2) * (t[m] - t[m - 1]);
  const a1 = a[n - 2], a2 = a[n - 1];
  const lam = a1 > 0 && a2 > 0 && a2 < a1 ? Math.max(Math.log(a1 / a2) / (t[n - 1] - t[n - 2]), lPhys) : lPhys;
  return area + a2 / lam;
}

/** Densities (g/ml) of the reference grid from the CT (1 g/ml without CT). */
export function densityMap(ref: Placed, ct?: Placed): Float32Array {
  const { nx, ny, nz } = ref.volume;
  const rho = new Float32Array(nx * ny * nz).fill(1);
  if (!ct) return rho;
  const map = voxelMap(ref, ct);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const p = map(i, j, k);
        const inside = p[0] > -0.5 && p[1] > -0.5 && p[2] > -0.5 && p[0] < ct.volume.nx - 0.5 && p[1] < ct.volume.ny - 0.5 && p[2] < ct.volume.nz - 0.5;
        rho[(k * ny + j) * nx + i] = inside ? densityFromHu(trilinear(ct.volume, p[0], p[1], p[2])) : 0.0012; // air outside the CT
      }
  return rho;
}

/**
 * Absorbed dose (Gy) per voxel from the TIA per ml: local deposition of the electron energy,
 * D = TIA·N·E / (ρ·1 ml), or kernel convolution D = (TIA·3600·V) ∗ S scaled by ρ_water/ρ.
 */
export function doseFromTia(tiaPerMl: Float32Array, rho: Float32Array, ref: Volume3D, o: Pick<VoxelDoseOptions, "electronKeV" | "kernel">): Float32Array {
  const out = new Float32Array(tiaPerMl.length);
  if (!o.kernel) {
    const k = DECAYS_PER_MBQH * o.electronKeV * J_PER_KEV * 1000; // J per (MBq·h/ml) per g/ml → Gy
    for (let i = 0; i < out.length; i++) out[i] = rho[i] > 0.05 ? (tiaPerMl[i] * k) / rho[i] : 0;
    return out;
  }
  const vml = voxelMl(ref);
  const src = new Float32Array(tiaPerMl.length);
  for (let i = 0; i < src.length; i++) src[i] = tiaPerMl[i] * vml * 3600; // MBq·s per voxel
  const conv = convolve3d(src, [ref.nx, ref.ny, ref.nz], o.kernel);
  for (let i = 0; i < out.length; i++) out[i] = rho[i] > 0.05 ? conv[i] / rho[i] : 0;
  return out;
}

/** 3D convolution (FFT) of `data` with a cubic kernel (x fastest), cropped to the non-zero bounding box. */
export function convolve3d(data: Float32Array, dims: [number, number, number], kernel: DoseKernel): Float32Array {
  const [nx, ny, nz] = dims;
  const r = kernel.radius, kw = 2 * r + 1;
  let lo = [nx, ny, nz], hi = [-1, -1, -1];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        if (data[(k * ny + j) * nx + i] !== 0) {
          lo = [Math.min(lo[0], i), Math.min(lo[1], j), Math.min(lo[2], k)];
          hi = [Math.max(hi[0], i), Math.max(hi[1], j), Math.max(hi[2], k)];
        }
  const out = new Float32Array(data.length);
  if (hi[0] < 0) return out;
  // Output box = source box grown by r (clipped to the volume).
  const ob = [0, 1, 2].map((a) => [Math.max(0, lo[a] - r), Math.min(dims[a] - 1, hi[a] + r)]);
  const sz = [0, 1, 2].map((a) => nextPow2(hi[a] - lo[a] + 1 + 2 * r));
  const N = sz[0] * sz[1] * sz[2];
  const are = new Float64Array(N), aim = new Float64Array(N), kre = new Float64Array(N), kim = new Float64Array(N);
  for (let k = lo[2]; k <= hi[2]; k++)
    for (let j = lo[1]; j <= hi[1]; j++)
      for (let i = lo[0]; i <= hi[0]; i++) are[((k - lo[2]) * sz[1] + (j - lo[1])) * sz[0] + (i - lo[0])] = data[(k * ny + j) * nx + i];
  // Kernel centered at index 0 (wrapped).
  for (let c = 0; c < kw; c++)
    for (let b = 0; b < kw; b++)
      for (let a = 0; a < kw; a++) {
        const x = (a - r + sz[0]) % sz[0], y = (b - r + sz[1]) % sz[1], z = (c - r + sz[2]) % sz[2];
        kre[(z * sz[1] + y) * sz[0] + x] = kernel.values[(c * kw + b) * kw + a];
      }
  fft3(are, aim, sz, false);
  fft3(kre, kim, sz, false);
  for (let i = 0; i < N; i++) {
    const re = are[i] * kre[i] - aim[i] * kim[i];
    aim[i] = are[i] * kim[i] + aim[i] * kre[i];
    are[i] = re;
  }
  fft3(are, aim, sz, true);
  for (let k = ob[2][0]; k <= ob[2][1]; k++)
    for (let j = ob[1][0]; j <= ob[1][1]; j++)
      for (let i = ob[0][0]; i <= ob[0][1]; i++) {
        const x = (i - lo[0] + sz[0]) % sz[0], y = (j - lo[1] + sz[1]) % sz[1], z = (k - lo[2] + sz[2]) % sz[2];
        out[(k * ny + j) * nx + i] = are[(z * sz[1] + y) * sz[0] + x];
      }
  return out;
}

function fft3(re: Float64Array, im: Float64Array, sz: number[], invert: boolean) {
  const [sx, sy, sz2] = sz;
  const line = (n: number, start: number, stride: number) => {
    const r = new Float64Array(n), m = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      r[i] = re[start + i * stride];
      m[i] = im[start + i * stride];
    }
    fft(r, m, invert);
    for (let i = 0; i < n; i++) {
      re[start + i * stride] = r[i];
      im[start + i * stride] = m[i];
    }
  };
  for (let k = 0; k < sz2; k++) for (let j = 0; j < sy; j++) line(sx, (k * sy + j) * sx, 1);
  for (let k = 0; k < sz2; k++) for (let i = 0; i < sx; i++) line(sy, k * sy * sx + i, sx);
  for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) line(sz2, j * sx + i, sx * sy);
}

/**
 * Parses a dose voxel kernel table: one line per voxel "i j k S" (offsets in voxels, S in the given unit per
 * MBq·s or per decay), separators space, tab, comma or semicolon; lines starting with # are ignored. Only the
 * octant i, j, k ≥ 0 may be given (mirrored by symmetry).
 */
export function parseKernel(text: string, name: string, voxelMm: number, unit: "mGy/MBq·s" | "Gy/MBq·s" | "Gy/Bq·s"): DoseKernel {
  const rows: [number, number, number, number][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/[\s,;]+/).map((s) => Number(s.replace(",", ".")));
    if (parts.length < 4 || parts.slice(0, 4).some((v) => !Number.isFinite(v))) continue;
    rows.push([Math.round(parts[0]), Math.round(parts[1]), Math.round(parts[2]), parts[3]]);
  }
  if (!rows.length) throw new Error(t("Keine Kernel-Werte (Zeilen „i j k S“) gefunden."));
  const octant = rows.every(([i, j, k]) => i >= 0 && j >= 0 && k >= 0);
  const r = Math.max(...rows.map(([i, j, k]) => Math.max(Math.abs(i), Math.abs(j), Math.abs(k))));
  const kw = 2 * r + 1;
  const values = new Float32Array(kw * kw * kw);
  const scale = unit === "mGy/MBq·s" ? 1e-3 : unit === "Gy/Bq·s" ? 1e6 : 1;
  const set = (i: number, j: number, k: number, v: number) => (values[((k + r) * kw + (j + r)) * kw + (i + r)] = v * scale);
  for (const [i, j, k, v] of rows) {
    if (!octant) set(i, j, k, v);
    else for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) set(sx * i, sy * j, sz * k, v);
  }
  return { name, voxelMm, radius: r, values };
}

/** Dose values of a region (label voxels mapped onto the dose grid). */
export function regionDoses(labels: Placed, dose: Placed, labelIds: Set<number>): Float32Array {
  const map = voxelMap(labels, dose);
  const { nx, ny, nz, data } = labels.volume;
  const vals: number[] = [];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!labelIds.has(Math.round(data[(k * ny + j) * nx + i]))) continue;
        const p = map(i, j, k);
        vals.push(trilinear(dose.volume, p[0], p[1], p[2]));
      }
  return Float32Array.from(vals);
}

export interface DvhStats {
  mean: number;
  d2: number;
  d50: number;
  d98: number;
  max: number;
  /** Cumulative DVH: dose (Gy) → % volume receiving at least this dose. */
  curve: { dose: number[]; volumePct: number[] };
}

/** Mean, D2 %, D50 %, D98 % (dose received by at least that volume fraction) and the cumulative DVH. */
export function dvh(values: Float32Array, bins = 100): DvhStats | null {
  if (!values.length) return null;
  const s = Float32Array.from(values).sort();
  const n = s.length;
  const q = (f: number) => s[Math.min(n - 1, Math.max(0, Math.floor(f * n)))];
  let sum = 0;
  for (const v of s) sum += v;
  const max = s[n - 1];
  const dose: number[] = [], vol: number[] = [];
  for (let b = 0; b <= bins; b++) {
    const d = (max * b) / bins;
    // Count of values ≥ d via binary search.
    let lo = 0, hi = n;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (s[m] < d) lo = m + 1;
      else hi = m;
    }
    dose.push(d);
    vol.push(((n - lo) / n) * 100);
  }
  return { mean: sum / n, d2: q(0.98), d50: q(0.5), d98: q(0.02), max, curve: { dose, volumePct: vol } };
}
