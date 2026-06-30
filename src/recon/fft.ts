/** In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array, invert: boolean): void {
  const n = re.length;
  if (n !== im.length) throw new Error("fft: re/im length mismatch");
  if (n & (n - 1)) throw new Error("fft: length must be a power of two");

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((invert ? 1 : -1) * 2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curWRe = 1;
      let curWIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curWRe - im[i + j + len / 2] * curWIm;
        const vIm = re[i + j + len / 2] * curWIm + im[i + j + len / 2] * curWRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nextWRe = curWRe * wRe - curWIm * wIm;
        const nextWIm = curWRe * wIm + curWIm * wRe;
        curWRe = nextWRe;
        curWIm = nextWIm;
      }
    }
  }

  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export type RampFilterType = "ramp" | "shepp-logan" | "cosine" | "hamming" | "hann";

/**
 * Builds the frequency-domain ramp filter response |f| * window(f), sampled at `size` FFT bins
 * (size must be a power of two). Follows the standard filtered-backprojection filter formulas
 * (Kak & Slaney; matches MATLAB's iradon filter definitions) with Nyquist frequency fN = 0.5.
 */
export function buildRampFilterKernel(size: number, filterType: RampFilterType): Float64Array {
  const kernel = new Float64Array(size);
  for (let k = 0; k < size; k++) {
    // FFT bin frequency in cycles/sample, range (-0.5, 0.5].
    const f = k <= size / 2 ? k / size : (k - size) / size;
    const af = Math.abs(f);
    let w = 1;
    switch (filterType) {
      case "ramp":
        w = 1;
        break;
      case "shepp-logan":
        w = af === 0 ? 1 : Math.sin(Math.PI * f) / (Math.PI * f);
        break;
      case "cosine":
        w = Math.cos(Math.PI * f);
        break;
      case "hamming":
        w = 0.54 + 0.46 * Math.cos(2 * Math.PI * f);
        break;
      case "hann":
        w = 0.5 + 0.5 * Math.cos(2 * Math.PI * f);
        break;
    }
    kernel[k] = af * w;
  }
  return kernel;
}

/**
 * Applies the ramp filter to every angle-row of a (numAngles x cols) sinogram slice, in place,
 * using zero-padded FFT convolution to avoid wraparound.
 */
export function filterSinogramSlice(
  sliceSinogram: Float32Array,
  numAngles: number,
  cols: number,
  filterType: RampFilterType,
): Float32Array {
  const paddedSize = nextPow2(2 * cols);
  const kernel = buildRampFilterKernel(paddedSize, filterType);
  const out = new Float32Array(numAngles * cols);
  const re = new Float64Array(paddedSize);
  const im = new Float64Array(paddedSize);
  for (let a = 0; a < numAngles; a++) {
    re.fill(0);
    im.fill(0);
    const base = a * cols;
    for (let c = 0; c < cols; c++) re[c] = sliceSinogram[base + c];
    fft(re, im, false);
    for (let k = 0; k < paddedSize; k++) {
      re[k] *= kernel[k];
      im[k] *= kernel[k];
    }
    fft(re, im, true);
    for (let c = 0; c < cols; c++) out[base + c] = re[c];
  }
  return out;
}
