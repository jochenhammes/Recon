import { type VolumeGeometry, type WorldToVoxel, applyWorldToVoxel, voxelToWorld } from "../core/geometry";
import { isBone } from "../tumor/organs";

/** Window as [lower, upper] HU. */
export type HuWindow = [number, number];

/** Classic windows (center/width): soft tissue 40/400, lung −600/1500, bone 300/1500. */
export const TRIPLE_DEFAULTS = { soft: [-160, 240] as HuWindow, lung: [-1350, 150] as HuWindow, bone: [-450, 1050] as HuWindow };

/** Organ label names shown in the lung window (lung lobes and airways). */
export function isLungLike(labelName: string): boolean {
  return /^(lung|trachea|bronch)/.test(labelName.replace(/ /g, "_").toLowerCase());
}

/** Region per label number: 1 = lung window, 2 = bone window, 0 = soft tissue. */
export function regionTable(labels: Map<number, string>): Uint8Array {
  const t = new Uint8Array(256);
  for (const [n, name] of labels) if (n > 0 && n < 256) t[n] = isBone(name) ? 2 : isLungLike(name) ? 1 : 0;
  return t;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Region codes: 0 soft tissue, 1 lung, 2 bone, 3 lung rim, 4 bone rim (rims are shown black). */
export const LUNG_RIM = 3;
export const BONE_RIM = 4;

/**
 * Morphological step on the region map (6-neighbourhood), repeated `steps` times:
 * - mode "grow": soft-tissue voxels (0) next to `from` (or already marked) become `to`;
 * - mode "shrink": voxels of `from` next to anything else than `from`/`to` become `to`.
 */
export async function morph(region: Uint8Array, dims: [number, number, number], mode: "grow" | "shrink", from: number, to: number, steps: number): Promise<void> {
  const [nx, ny, nz] = dims;
  const sxy = nx * ny;
  const MARK = 255;
  // Voxels marked in the current step count as source only when shrinking (no cascade within one grow step).
  const is = mode === "grow" ? (v: number) => v === from || v === to : (v: number) => v === from || v === to || v === MARK;
  for (let s = 0; s < steps; s++) {
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        const row = z * sxy + y * nx;
        for (let x = 0; x < nx; x++) {
          const i = row + x;
          const r = region[i];
          if (mode === "grow" ? r !== 0 : r !== from) continue;
          let hit: boolean;
          if (mode === "grow")
            hit =
              (x > 0 && is(region[i - 1])) ||
              (x < nx - 1 && is(region[i + 1])) ||
              (y > 0 && is(region[i - nx])) ||
              (y < ny - 1 && is(region[i + nx])) ||
              (z > 0 && is(region[i - sxy])) ||
              (z < nz - 1 && is(region[i + sxy]));
          else
            hit =
              (x > 0 && !is(region[i - 1])) ||
              (x < nx - 1 && !is(region[i + 1])) ||
              (y > 0 && !is(region[i - nx])) ||
              (y < ny - 1 && !is(region[i + nx])) ||
              (z > 0 && !is(region[i - sxy])) ||
              (z < nz - 1 && !is(region[i + sxy]));
          if (hit) region[i] = MARK;
        }
      }
      if (z % 32 === 31) await tick();
    }
    for (let i = 0; i < region.length; i++) if (region[i] === MARK) region[i] = to;
  }
}

/**
 * Black rims around lungs and bones: the transition between the windows (pleura/chest wall, partial volume of the
 * coarser organ map) would otherwise appear as a bright band. Lungs get a rim on both sides of their border, bones
 * only outside (the cortex stays in the bone window).
 */
export async function addRims(region: Uint8Array, dims: [number, number, number], stepsLung: number, stepsBone: number): Promise<void> {
  await morph(region, dims, "grow", 2, BONE_RIM, stepsBone);
  await morph(region, dims, "shrink", 1, LUNG_RIM, Math.ceil(stepsLung / 2));
  await morph(region, dims, "grow", 1, LUNG_RIM, Math.ceil(stepsLung / 2));
}

/**
 * Triple-window CT: every voxel keeps its HU in the soft-tissue window; lung and bone voxels are mapped linearly so
 * that the soft-tissue window shows them as the lung or bone window would (clamped to the soft-tissue window);
 * rim voxels (codes 3, 4) are shown black.
 * One display window then shows soft tissue, lungs and skeleton – an anatomical overview, not a diagnostic window.
 */
export async function tripleWindow(hu: ArrayLike<number>, region: Uint8Array, windows = TRIPLE_DEFAULTS): Promise<Float32Array> {
  const [s0, s1] = windows.soft;
  const map = (w: HuWindow) => {
    const k = (s1 - s0) / (w[1] - w[0] || 1);
    return (v: number) => Math.min(s1, Math.max(s0, s0 + (v - w[0]) * k));
  };
  const lung = map(windows.lung), bone = map(windows.bone);
  const out = new Float32Array(hu.length);
  for (let i = 0; i < hu.length; i++) {
    const r = region[i];
    out[i] = r === 1 ? lung(hu[i]) : r === 2 ? bone(hu[i]) : r >= LUNG_RIM ? s0 : hu[i];
    if ((i & 0xfffff) === 0xfffff) await tick();
  }
  return out;
}

/**
 * Region map (0 soft, 1 lung, 2 bone) on the CT grid, read directly from the organ labels by nearest neighbour –
 * one byte per CT voxel, no intermediate resampled volume (large CTs would need several GB otherwise).
 * `ctToOrgan` maps the CT's own world coordinates to organ-label voxel indices.
 */
export async function regionOnGrid(
  organs: { nx: number; ny: number; nz: number; data: ArrayLike<number> },
  ctToOrgan: WorldToVoxel,
  ct: { nx: number; ny: number; nz: number; geometry: VolumeGeometry },
  table: Uint8Array,
): Promise<Uint8Array> {
  const { nx, ny, nz } = ct;
  const map = (i: number, j: number, k: number) => applyWorldToVoxel(ctToOrgan, voxelToWorld(ct.geometry, i, j, k));
  const p0 = map(0, 0, 0);
  const d = [map(1, 0, 0), map(0, 1, 0), map(0, 0, 1)].map((p) => [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]]);
  const ox = organs.nx, oy = organs.ny, oz = organs.nz, oxy = ox * oy;
  const out = new Uint8Array(nx * ny * nz);
  let o = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      let x = p0[0] + j * d[1][0] + k * d[2][0];
      let y = p0[1] + j * d[1][1] + k * d[2][1];
      let z = p0[2] + j * d[1][2] + k * d[2][2];
      for (let i = 0; i < nx; i++, o++) {
        const a = Math.round(x), b = Math.round(y), c = Math.round(z);
        if (a >= 0 && b >= 0 && c >= 0 && a < ox && b < oy && c < oz) {
          const l = organs.data[c * oxy + b * ox + a];
          if (l > 0 && l < 256) out[o] = table[l];
        }
        x += d[0][0];
        y += d[0][1];
        z += d[0][2];
      }
    }
    if (k % 16 === 15) await tick();
  }
  return out;
}

// ─── Smooth version: soft masks from the coarse organ map, upsampled per CT voxel ──────────────────────────────

/** Standard normal CDF Φ (Abramowitz–Stegun 7.1.26 erf approximation, |error| < 1.5e-7). */
function phi(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Table for Φ⁻¹ on [0, 1] (4096 steps), clamped to ±4. */
const PROBIT = (() => {
  const n = 4096;
  const t = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const p = i / n;
    let lo = -4, hi = 4;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (phi(mid) < p) lo = mid;
      else hi = mid;
    }
    t[i] = (lo + hi) / 2;
  }
  return t;
})();
const probit = (p: number) => PROBIT[Math.round(Math.min(1, Math.max(0, p)) * 4096)];

export interface SmoothTripleOptions {
  windows: { soft: HuWindow; lung: HuWindow; bone: HuWindow };
  /** Smoothing of the organ masks (FWHM, mm) – removes the staircase of the coarser organ map. */
  smoothMm: number;
  /** Black rim: lung on both sides of the border, bone outside (mm; 0 = none). */
  rimLungMm: number;
  rimBoneMm: number;
}

/**
 * Triple-window CT with soft borders and without a full-resolution mask:
 * 1. lung and bone indicator images on the (coarse) organ grid, Gaussian-smoothed there (`smooth`, a function so
 *    callers pass the existing filter);
 * 2. per CT voxel both are sampled trilinearly; for a smoothed straight edge the value equals Φ(d/σ), so
 *    d = σ·Φ⁻¹(value) is the signed distance (mm) to the border at CT resolution;
 * 3. the windows are blended over ±0.75 mm around the border (bone wins over lung), optional black rims by distance.
 * Memory: the output volume plus two small organ-grid images.
 */
export async function smoothTripleWindow(
  ct: { nx: number; ny: number; nz: number; data: ArrayLike<number>; geometry: VolumeGeometry },
  organs: { nx: number; ny: number; nz: number; data: ArrayLike<number> },
  ctToOrgan: WorldToVoxel,
  table: Uint8Array,
  smooth: (indicator: Float32Array, fwhmMm: number) => Float32Array,
  opts: SmoothTripleOptions,
  onProgress?: (f: number) => void,
): Promise<{ data: Float32Array; lungMl: number; boneMl: number }> {
  const on = organs.nx * organs.ny * organs.nz;
  const lungInd = new Float32Array(on), boneInd = new Float32Array(on);
  for (let i = 0; i < on; i++) {
    const l = organs.data[i];
    const r = l > 0 && l < 256 ? table[l] : 0;
    if (r === 1) lungInd[i] = 1;
    else if (r === 2) boneInd[i] = 1;
  }
  const fwhm = Math.max(0.1, opts.smoothMm);
  const sigma = fwhm / (2 * Math.sqrt(2 * Math.log(2)));
  const L = smooth(lungInd, fwhm);
  const B = smooth(boneInd, fwhm);
  await tick();

  const [s0, s1] = opts.windows.soft;
  const lin = (w: HuWindow) => {
    const k = (s1 - s0) / (w[1] - w[0] || 1);
    return (v: number) => Math.min(s1, Math.max(s0, s0 + (v - w[0]) * k));
  };
  const lungMap = lin(opts.windows.lung), boneMap = lin(opts.windows.bone);
  const H = 0.75; // half width of the blend (mm)
  const ramp = (d: number) => Math.min(1, Math.max(0, (d + H) / (2 * H)));
  const rimL = opts.rimLungMm / 2, rimB = opts.rimBoneMm;

  const { nx, ny, nz } = ct;
  const map = (i: number, j: number, k: number) => applyWorldToVoxel(ctToOrgan, voxelToWorld(ct.geometry, i, j, k));
  const p0 = map(0, 0, 0);
  const d = [map(1, 0, 0), map(0, 1, 0), map(0, 0, 1)].map((p) => [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]]);
  const ox = organs.nx, oy = organs.ny, oz = organs.nz, oxy = ox * oy;
  // Trilinear sample of both smoothed indicators (0 outside the organ grid).
  const sample = (x: number, y: number, z: number, out: number[]) => {
    out[0] = out[1] = 0;
    if (x < 0 || y < 0 || z < 0 || x > ox - 1 || y > oy - 1 || z > oz - 1) return;
    const x0 = Math.min(ox - 1, Math.floor(x)), y0 = Math.min(oy - 1, Math.floor(y)), z0 = Math.min(oz - 1, Math.floor(z));
    const fx = x - x0, fy = y - y0, fz = z - z0;
    // Neighbour offsets (0 at the last voxel of an axis, e.g. for one-voxel-thick grids).
    const dx = x0 < ox - 1 ? 1 : 0, dy = y0 < oy - 1 ? ox : 0, dz = z0 < oz - 1 ? oxy : 0;
    const a = z0 * oxy + y0 * ox + x0, b = a + dy, c = a + dz, e = c + dy;
    const gx = 1 - fx, gy = 1 - fy, gz = 1 - fz;
    out[0] = gz * (gy * (gx * L[a] + fx * L[a + dx]) + fy * (gx * L[b] + fx * L[b + dx])) + fz * (gy * (gx * L[c] + fx * L[c + dx]) + fy * (gx * L[e] + fx * L[e + dx]));
    out[1] = gz * (gy * (gx * B[a] + fx * B[a + dx]) + fy * (gx * B[b] + fx * B[b + dx])) + fz * (gy * (gx * B[c] + fx * B[c + dx]) + fy * (gx * B[e] + fx * B[e + dx]));
  };


  const out = new Float32Array(nx * ny * nz);
  const s = [0, 0];
  let lungN = 0, boneN = 0;
  let o = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      let x = p0[0] + j * d[1][0] + k * d[2][0];
      let y = p0[1] + j * d[1][1] + k * d[2][1];
      let z = p0[2] + j * d[1][2] + k * d[2][2];
      for (let i = 0; i < nx; i++, o++) {
        const hu = ct.data[o];
        sample(x, y, z, s);
        let v = hu;
        if (s[0] > 0.02 || s[1] > 0.02) {
          const dl = sigma * probit(s[0]), db = sigma * probit(s[1]); // signed distance (mm), > 0 inside
          const wb = ramp(db);
          const wl = Math.min(ramp(dl), 1 - wb);
          v = (1 - wl - wb) * hu + wl * lungMap(hu) + wb * boneMap(hu);
          let black = 0;
          if (rimL > 0) black = Math.max(black, ramp(rimL - Math.abs(dl)));
          if (rimB > 0 && db < 0) black = Math.max(black, ramp(rimB + db) * ramp(-db));
          if (black > 0) v = (1 - black) * v + black * s0;
          if (wl > 0.5) lungN++;
          else if (wb > 0.5) boneN++;
        }
        out[o] = v;
        x += d[0][0];
        y += d[0][1];
        z += d[0][2];
      }
    }
    if (k % 8 === 7) {
      onProgress?.(k / nz);
      await tick();
    }
  }
  const voxMl = (ct.geometry.spacing[0] * ct.geometry.spacing[1] * ct.geometry.spacing[2]) / 1000;
  return { data: out, lungMl: lungN * voxMl, boneMl: boneN * voxMl };
}
