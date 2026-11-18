/**
 * IMCALC: voxelwise image arithmetic on datasets on the same voxel grid. All inputs are display values
 * (raw · scale, e.g. SUV); results are new volumes on the same grid.
 */

/** Values given as raw data plus a display scale (display = raw · scale). */
export interface ScaledInput {
  data: ArrayLike<number>;
  scale: number;
}

const finite = (v: number) => (Number.isFinite(v) ? v : 0);

/** Lets the UI breathe between chunks of a long loop. */
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));
const CHUNK = 1 << 20;

async function mapChunked(n: number, f: (i: number) => number, onProgress?: (fraction: number) => void): Promise<Float32Array> {
  const out = new Float32Array(n);
  for (let start = 0; start < n; start += CHUNK) {
    const end = Math.min(n, start + CHUNK);
    for (let i = start; i < end; i++) out[i] = finite(f(i));
    onProgress?.(end / n);
    if (end < n) await yieldToUi();
  }
  return out;
}

/** a · X + b */
export async function linear(x: ScaledInput, a: number, b: number, onProgress?: (f: number) => void): Promise<Float32Array> {
  const s = x.scale;
  return mapChunked(x.data.length, (i) => a * x.data[i] * s + b, onProgress);
}

/** a · X₁ + b · X₂ */
export async function combine(x1: ScaledInput, x2: ScaledInput, a: number, b: number, onProgress?: (f: number) => void): Promise<Float32Array> {
  checkLength([x1, x2]);
  const s1 = x1.scale, s2 = x2.scale;
  return mapChunked(x1.data.length, (i) => a * x1.data[i] * s1 + b * x2.data[i] * s2, onProgress);
}

/** X₁ · X₂ */
export async function product(x1: ScaledInput, x2: ScaledInput, onProgress?: (f: number) => void): Promise<Float32Array> {
  checkLength([x1, x2]);
  const s = x1.scale * x2.scale;
  return mapChunked(x1.data.length, (i) => x1.data[i] * x2.data[i] * s, onProgress);
}

/** X₁ / X₂; voxels with |X₂| below 1e-6 · max|X₂| give 0. */
export async function quotient(x1: ScaledInput, x2: ScaledInput, onProgress?: (f: number) => void): Promise<Float32Array> {
  checkLength([x1, x2]);
  let max = 0;
  for (let i = 0; i < x2.data.length; i++) {
    const v = Math.abs(x2.data[i] * x2.scale);
    if (Number.isFinite(v) && v > max) max = v;
  }
  const eps = 1e-6 * max;
  return mapChunked(
    x1.data.length,
    (i) => {
      const d = x2.data[i] * x2.scale;
      return Math.abs(d) <= eps ? 0 : (x1.data[i] * x1.scale) / d;
    },
    onProgress,
  );
}

/**
 * Voxelwise mean and sample standard deviation (n − 1) of a group (Welford's algorithm in double precision; the
 * inputs are streamed one by one, memory does not grow with the group size).
 */
export async function groupMeanSd(xs: ScaledInput[], onProgress?: (f: number) => void): Promise<{ mean: Float32Array; sd: Float32Array }> {
  if (xs.length < 2) throw new Error("Mittelwert und SD brauchen mindestens 2 Datensätze.");
  checkLength(xs);
  const n = xs[0].data.length;
  const mean = new Float64Array(n);
  const m2 = new Float64Array(n);
  for (const [k, x] of xs.entries()) {
    const count = k + 1;
    const s = x.scale;
    for (let start = 0; start < n; start += CHUNK) {
      const end = Math.min(n, start + CHUNK);
      for (let i = start; i < end; i++) {
        const v = finite(x.data[i] * s);
        const d = v - mean[i];
        mean[i] += d / count;
        m2[i] += d * (v - mean[i]);
      }
      onProgress?.((k + end / n) / xs.length);
      await yieldToUi();
    }
  }
  const sd = new Float32Array(n);
  const div = xs.length - 1;
  for (let i = 0; i < n; i++) sd[i] = Math.sqrt(Math.max(0, m2[i] / div));
  return { mean: Float32Array.from(mean), sd };
}

/** Threshold below which a standard deviation counts as zero: 1e-3 · median of the positive SDs. */
export function sdFloor(sd: ScaledInput): number {
  const step = Math.max(1, Math.floor(sd.data.length / 200000));
  const pos: number[] = [];
  for (let i = 0; i < sd.data.length; i += step) {
    const v = sd.data[i] * sd.scale;
    if (v > 0 && Number.isFinite(v)) pos.push(v);
  }
  if (!pos.length) return Infinity;
  pos.sort((a, b) => a - b);
  return 1e-3 * pos[Math.floor(pos.length / 2)];
}

/** (X − mean) / SD; voxels with SD ≤ sdFloor give 0 (no spikes outside the head). */
export async function zScore(x: ScaledInput, mean: ScaledInput, sd: ScaledInput, onProgress?: (f: number) => void): Promise<Float32Array> {
  checkLength([x, mean, sd]);
  const eps = sdFloor(sd);
  return mapChunked(
    x.data.length,
    (i) => {
      const s = sd.data[i] * sd.scale;
      return s <= eps ? 0 : (x.data[i] * x.scale - mean.data[i] * mean.scale) / s;
    },
    onProgress,
  );
}

function checkLength(xs: ScaledInput[]) {
  const n = xs[0].data.length;
  if (xs.some((x) => x.data.length !== n)) throw new Error("Die Datensätze haben unterschiedlich viele Voxel.");
}
