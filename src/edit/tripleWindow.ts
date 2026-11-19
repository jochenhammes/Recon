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
