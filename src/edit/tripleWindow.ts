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

/**
 * Grows the voxels of `region` value `value` by `steps` voxels (6-neighbourhood) into soft-tissue voxels (0),
 * so the edges of lungs/bones (pleura, cortex, partial volume of the coarser organ map) get the special window too.
 */
export async function dilateRegion(region: Uint8Array, dims: [number, number, number], value: number, steps: number): Promise<void> {
  const [nx, ny, nz] = dims;
  const sxy = nx * ny;
  for (let s = 0; s < steps; s++) {
    const add: number[] = [];
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        const row = z * sxy + y * nx;
        for (let x = 0; x < nx; x++) {
          const i = row + x;
          if (region[i] !== 0) continue;
          if (
            (x > 0 && region[i - 1] === value) ||
            (x < nx - 1 && region[i + 1] === value) ||
            (y > 0 && region[i - nx] === value) ||
            (y < ny - 1 && region[i + nx] === value) ||
            (z > 0 && region[i - sxy] === value) ||
            (z < nz - 1 && region[i + sxy] === value)
          )
            add.push(i);
        }
      }
      if (z % 32 === 31) await tick();
    }
    for (const i of add) region[i] = value;
  }
}

/**
 * Triple-window CT: every voxel keeps its HU in the soft-tissue window; lung and bone voxels are mapped linearly so
 * that the soft-tissue window shows them as the lung or bone window would (clamped to the soft-tissue window).
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
    out[i] = r === 1 ? lung(hu[i]) : r === 2 ? bone(hu[i]) : hu[i];
    if ((i & 0xfffff) === 0xfffff) await tick();
  }
  return out;
}
