/** Similarity measures between a fixed (reference) and a moving image, evaluated on sample points. */
export type CostName = "nmi" | "mi" | "cr" | "ncc";

export const COST_LABELS: Record<CostName, string> = {
  nmi: "Normalisierte Mutual Information (SPM-Standard)",
  mi: "Mutual Information",
  cr: "Correlation Ratio (FLIRT, intermodal)",
  ncc: "Normalisierte Kreuzkorrelation (gleiche Modalität)",
};

/**
 * Histogram size. SPM uses 256 bins smoothed with FWHM 7; 128 bins with FWHM 3.5 give the same
 * effective intensity resolution at a quarter of the cost.
 */
export const BINS = 128;
const BIN_SCALE = (BINS - 1) / 255;

/**
 * Joint histogram accumulator: fixed intensities are pre-binned (0..BINS-1 integers), moving
 * intensities (0..255 floats, rescaled to bins) are distributed linearly over the two neighbouring bins
 * (partial-volume style), which keeps the cost smooth in the transform parameters.
 */
export class JointHistogram {
  readonly h = new Float64Array(BINS * BINS);
  count = 0;

  reset(): void {
    this.h.fill(0);
    this.count = 0;
  }

  add(fixedBin: number, moving: number): void {
    const mb = moving * BIN_SCALE;
    const m = mb < 0 ? 0 : mb > BINS - 1 ? BINS - 1 : mb;
    const m0 = Math.floor(m);
    const f = m - m0;
    const row = fixedBin * BINS;
    this.h[row + m0] += 1 - f;
    if (m0 < BINS - 1) this.h[row + m0 + 1] += f;
    this.count++;
  }

  /** Separable Gaussian smoothing of the histogram (SPM: FWHM 7 of 256 bins). */
  smooth(fwhmBins = (7 * BINS) / 256): void {
    const sigma = fwhmBins / (2 * Math.sqrt(2 * Math.log(2)));
    const r = Math.ceil(3 * sigma);
    const k = new Float64Array(2 * r + 1);
    let ks = 0;
    for (let i = -r; i <= r; i++) ks += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
    for (let i = 0; i < k.length; i++) k[i] /= ks;
    const tmp = new Float64Array(BINS * BINS);
    // Along moving axis (columns).
    for (let a = 0; a < BINS; a++) {
      const row = a * BINS;
      for (let b = 0; b < BINS; b++) {
        let s = 0;
        for (let t = -r; t <= r; t++) {
          const bb = b + t;
          if (bb >= 0 && bb < BINS) s += this.h[row + bb] * k[t + r];
        }
        tmp[row + b] = s;
      }
    }
    // Along fixed axis (rows).
    for (let b = 0; b < BINS; b++)
      for (let a = 0; a < BINS; a++) {
        let s = 0;
        for (let t = -r; t <= r; t++) {
          const aa = a + t;
          if (aa >= 0 && aa < BINS) s += tmp[aa * BINS + b] * k[t + r];
        }
        this.h[a * BINS + b] = s;
      }
  }

  /** Entropies H(fixed), H(moving), H(joint) (natural log). */
  entropies(): { hf: number; hm: number; hj: number } {
    const h = this.h;
    let total = 0;
    for (let i = 0; i < h.length; i++) total += h[i];
    if (total <= 0) return { hf: 0, hm: 0, hj: 0 };
    const pf = new Float64Array(BINS);
    const pm = new Float64Array(BINS);
    let hj = 0;
    for (let a = 0; a < BINS; a++)
      for (let b = 0; b < BINS; b++) {
        const p = h[a * BINS + b] / total;
        if (p > 0) {
          hj -= p * Math.log(p);
          pf[a] += p;
          pm[b] += p;
        }
      }
    let hf = 0;
    let hm = 0;
    for (let i = 0; i < BINS; i++) {
      if (pf[i] > 0) hf -= pf[i] * Math.log(pf[i]);
      if (pm[i] > 0) hm -= pm[i] * Math.log(pm[i]);
    }
    return { hf, hm, hj };
  }

  /** Normalized mutual information (H(F)+H(M))/H(F,M), between 1 and 2 (Studholme). */
  nmi(): number {
    const { hf, hm, hj } = this.entropies();
    return hj > 0 ? (hf + hm) / hj : 1;
  }

  mi(): number {
    const { hf, hm, hj } = this.entropies();
    return hf + hm - hj;
  }

  /**
   * Correlation ratio cost (FLIRT): Σ_k n_k·Var(M | F = k) / (N·Var(M)), 0 = perfect functional
   * dependence of the moving on the fixed intensities, 1 = none.
   */
  correlationRatioCost(): number {
    const h = this.h;
    let n = 0;
    let s = 0;
    let s2 = 0;
    let within = 0;
    for (let a = 0; a < BINS; a++) {
      let na = 0;
      let sa = 0;
      let sa2 = 0;
      const row = a * BINS;
      for (let b = 0; b < BINS; b++) {
        const w = h[row + b];
        if (w === 0) continue;
        na += w;
        sa += w * b;
        sa2 += w * b * b;
      }
      if (na > 0) within += sa2 - (sa * sa) / na;
      n += na;
      s += sa;
      s2 += sa2;
    }
    const total = s2 - (s * s) / Math.max(n, 1e-12);
    return total > 0 ? within / total : 1;
  }
}

/** Running sums for the normalized cross-correlation. */
export class CorrelationAccumulator {
  n = 0;
  sf = 0;
  sm = 0;
  sff = 0;
  smm = 0;
  sfm = 0;

  reset(): void {
    this.n = this.sf = this.sm = this.sff = this.smm = this.sfm = 0;
  }

  add(f: number, m: number): void {
    this.n++;
    this.sf += f;
    this.sm += m;
    this.sff += f * f;
    this.smm += m * m;
    this.sfm += f * m;
  }

  ncc(): number {
    const { n } = this;
    if (n < 2) return 0;
    const cov = this.sfm - (this.sf * this.sm) / n;
    const vf = this.sff - (this.sf * this.sf) / n;
    const vm = this.smm - (this.sm * this.sm) / n;
    return vf > 0 && vm > 0 ? cov / Math.sqrt(vf * vm) : 0;
  }
}
