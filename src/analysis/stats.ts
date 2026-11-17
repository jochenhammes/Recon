/** Descriptive statistics over a voxel buffer. Non-finite values (NaN/±Inf) are excluded and counted separately. */
export interface VolumeStats {
  /** Total number of voxels in the buffer (including non-finite ones). */
  count: number;
  /** Number of NaN/±Infinity voxels, excluded from min/max/mean/median. */
  nonFinite: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  /** Sample variance (n − 1) and standard deviation of the finite values. */
  variance: number;
  sd: number;
}

export function computeStats(data: ArrayLike<number>): VolumeStats {
  const n = data.length;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let finite = 0;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    finite++;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (finite === 0) return { count: n, nonFinite: n, min: NaN, max: NaN, mean: NaN, median: NaN, variance: NaN, sd: NaN };
  const mean = sum / finite;

  // Float32 copy: the data is float32 anyway, and this halves memory for large volumes.
  const values = new Float32Array(finite);
  let k = 0;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (Number.isFinite(v)) {
      values[k++] = v;
      ss += (v - mean) * (v - mean);
    }
  }
  const variance = finite > 1 ? ss / (finite - 1) : 0;
  const mid = finite >> 1;
  let median: number;
  if (finite % 2 === 1) {
    median = quickselect(values, mid);
  } else {
    const upper = quickselect(values, mid);
    // After selecting `mid`, everything in [0, mid) is <= values[mid]; the lower middle is their max.
    let lower = -Infinity;
    for (let i = 0; i < mid; i++) if (values[i] > lower) lower = values[i];
    median = (lower + upper) / 2;
  }

  return { count: n, nonFinite: n - finite, min, max, mean, median, variance, sd: Math.sqrt(variance) };
}

/** In-place Hoare-style selection: returns the k-th smallest value (0-based) in O(n) average. */
export function quickselect(a: Float32Array | Float64Array, k: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const pivot = medianOfThree(a[lo], a[(lo + hi) >> 1], a[hi]);
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k];
  }
  return a[k];
}

function medianOfThree(a: number, b: number, c: number): number {
  if (a < b) {
    if (b < c) return b;
    return a < c ? c : a;
  }
  if (a < c) return a;
  return b < c ? c : b;
}

export interface Histogram {
  /** Bin edges, length bins + 1. Bin i covers [edges[i], edges[i+1]); the last bin is closed. */
  edges: Float64Array;
  counts: Uint32Array;
  /** Values outside [min, max] that were not counted (only non-zero when an explicit range is given). */
  outOfRange: number;
}

export interface HistogramOptions {
  bins: number;
  min?: number;
  max?: number;
  /** Skip voxels whose value is exactly 0 (typical empty background in nuclear medicine). */
  excludeZero?: boolean;
  /** Leave out the lowest bin (background: zeros, noise, air), counted as out of range. */
  excludeLowestBin?: boolean;
}

export function computeHistogram(data: ArrayLike<number>, opts: HistogramOptions): Histogram {
  const bins = Math.max(1, Math.floor(opts.bins));
  let lo = opts.min;
  let hi = opts.max;
  if (lo === undefined || hi === undefined) {
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (!Number.isFinite(v) || (opts.excludeZero && v === 0)) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    lo ??= Number.isFinite(mn) ? mn : 0;
    hi ??= Number.isFinite(mx) ? mx : 1;
  }
  if (!(hi > lo)) hi = lo + 1;

  const edges = new Float64Array(bins + 1);
  const width = (hi - lo) / bins;
  for (let i = 0; i <= bins; i++) edges[i] = lo + i * width;
  edges[bins] = hi;

  const counts = new Uint32Array(bins);
  let outOfRange = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v) || (opts.excludeZero && v === 0)) continue;
    if (v < lo || v > hi) {
      outOfRange++;
      continue;
    }
    let b = Math.floor((v - lo) / width);
    if (b >= bins) b = bins - 1;
    counts[b]++;
  }
  if (opts.excludeLowestBin) {
    outOfRange += counts[0];
    counts[0] = 0;
  }
  return { edges, counts, outOfRange };
}
