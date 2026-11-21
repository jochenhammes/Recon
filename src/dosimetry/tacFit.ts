/**
 * Time-activity curves of therapy dosimetry: fit and time-integrated activity (TIA).
 * Times in hours after injection, activities in MBq, TIA in MBq·h.
 */

export type TacModel = "mono" | "biUptake" | "trapezoid" | "hanscheid" | "madsen";

export const TAC_MODEL_LABELS: Record<TacModel, string> = {
  mono: "Monoexponentiell",
  biUptake: "Biexponentiell mit Aufnahme",
  trapezoid: "Trapez + Ausläufer",
  hanscheid: "Ein Zeitpunkt (Hänscheid)",
  madsen: "Ein Zeitpunkt (Madsen, T_eff)",
};

export interface TacFit {
  model: TacModel;
  ok: boolean;
  /** Time-integrated activity 0 … ∞ (MBq·h). */
  tia: number;
  /** Standard deviation of the TIA from the fit covariance (MBq·h), if determinable. */
  tiaSd?: number;
  /** Effective half-life of the washout (h). */
  teffH?: number;
  /** Akaike information criterion (small-sample corrected), if n > k + 1. */
  aicc?: number;
  /** Model curve for plotting. */
  curve: (tH: number) => number;
  note?: string;
}

export interface TacOptions {
  /** Physical half-life (h): the washout is not slower than physical decay. */
  physHalfLifeH: number;
  /** Population effective half-life (h) for the Madsen single-time-point method. */
  teffH?: number;
}

const LN2 = Math.LN2;

/** Levenberg–Marquardt on relative residuals (y − f)/y with numeric Jacobian. Returns parameters and J at the optimum. */
function levenbergMarquardt(
  f: (p: number[], t: number) => number,
  t: number[],
  y: number[],
  p0: number[],
): { p: number[]; ssr: number; jac: number[][]; ok: boolean } {
  const n = t.length, k = p0.length;
  const resid = (p: number[]) => t.map((ti, i) => (y[i] - f(p, ti)) / Math.max(Math.abs(y[i]), 1e-12));
  const ssrOf = (r: number[]) => r.reduce((s, v) => s + v * v, 0);
  const jacobian = (p: number[]) => {
    const J: number[][] = Array.from({ length: n }, () => new Array(k).fill(0));
    for (let j = 0; j < k; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(p[j]));
      const pp = [...p], pm = [...p];
      pp[j] += h;
      pm[j] -= h;
      for (let i = 0; i < n; i++) {
        const w = 1 / Math.max(Math.abs(y[i]), 1e-12);
        // Derivative of the residual = −w·∂f/∂p.
        J[i][j] = (-w * (f(pp, t[i]) - f(pm, t[i]))) / (2 * h);
      }
    }
    return J;
  };
  let p = [...p0];
  let r = resid(p);
  let ssr = ssrOf(r);
  let mu = 1e-3;
  let ok = Number.isFinite(ssr);
  for (let it = 0; it < 200 && ok; it++) {
    const J = jacobian(p);
    const A = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const g = Array.from({ length: k }, (_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 20; tries++) {
      const M = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + mu) + 1e-12 : v)));
      const step = solve(M, g.map((v) => -v));
      if (!step) {
        mu *= 10;
        continue;
      }
      const pn = p.map((v, j) => v + step[j]);
      const rn = resid(pn);
      const sn = ssrOf(rn);
      if (Number.isFinite(sn) && sn < ssr) {
        const done = ssr - sn < 1e-14 * Math.max(1, ssr);
        p = pn;
        r = rn;
        ssr = sn;
        mu = Math.max(mu / 10, 1e-12);
        improved = !done;
        break;
      }
      mu *= 10;
    }
    if (!improved) break;
  }
  return { p, ssr, jac: jacobian(p), ok: ok && p.every(Number.isFinite) };
}

/** Solves M x = b (Gaussian elimination with pivoting); null if singular. */
function solve(M: number[][], b: number[]): number[] | null {
  const n = b.length;
  const a = M.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    if (Math.abs(a[piv][c]) < 1e-300) return null;
    [a[c], a[piv]] = [a[piv], a[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let j = c; j <= n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

function invert(M: number[][]): number[][] | null {
  const n = M.length;
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0);
    e[j] = 1;
    const x = solve(M, e);
    if (!x) return null;
    cols.push(x);
  }
  return M.map((_, i) => cols.map((c) => c[i]));
}

/** SD of g(p) from the fit: s² · ∇gᵀ (JᵀJ)⁻¹ ∇g with s² = SSR/(n − k); undefined for n ≤ k. */
function deltaSd(jac: number[][], ssr: number, p: number[], g: (p: number[]) => number): number | undefined {
  const n = jac.length, k = p.length;
  if (n <= k) return undefined;
  const JtJ = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => jac.reduce((s, row) => s + row[a] * row[b], 0)));
  const C = invert(JtJ);
  if (!C) return undefined;
  const s2 = ssr / (n - k);
  const grad = p.map((v, j) => {
    const h = 1e-6 * Math.max(1, Math.abs(v));
    const pp = [...p], pm = [...p];
    pp[j] += h;
    pm[j] -= h;
    return (g(pp) - g(pm)) / (2 * h);
  });
  let v = 0;
  for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) v += grad[a] * C[a][b] * grad[b];
  const sd = Math.sqrt(Math.max(0, v * s2));
  return Number.isFinite(sd) ? sd : undefined;
}

function aiccOf(ssr: number, n: number, k: number): number | undefined {
  if (n - k - 1 <= 0 || !(ssr > 0)) return undefined;
  return n * Math.log(ssr / n) + 2 * k + (2 * k * (k + 1)) / (n - k - 1);
}

/** Log-linear slope of the last points (λ ≥ λ_phys). */
function washoutRate(t: number[], y: number[], lPhys: number): number {
  const m = Math.min(t.length, 3);
  const ts = t.slice(-m), ls = y.slice(-m).map((v) => Math.log(Math.max(v, 1e-12)));
  const mt = ts.reduce((s, v) => s + v, 0) / m, ml = ls.reduce((s, v) => s + v, 0) / m;
  let num = 0, den = 0;
  for (let i = 0; i < m; i++) {
    num += (ts[i] - mt) * (ls[i] - ml);
    den += (ts[i] - mt) ** 2;
  }
  const lam = den > 0 ? -num / den : lPhys;
  return Math.max(lam, lPhys * 1.0001);
}

/** A(t) = A0·e^{−λt}, λ = λ_phys + e^q (washout never slower than physical decay). */
export function fitMono(t: number[], y: number[], o: TacOptions): TacFit {
  const lPhys = LN2 / o.physHalfLifeH;
  const lam0 = washoutRate(t, y, lPhys);
  const a0 = Math.log(Math.max(y[y.length - 1], 1e-12)) + lam0 * t[t.length - 1];
  const f = (p: number[], ti: number) => Math.exp(p[0]) * Math.exp(-(lPhys + Math.exp(p[1])) * ti);
  const fit = levenbergMarquardt(f, t, y, [a0, Math.log(Math.max(lam0 - lPhys, lPhys * 1e-4))]);
  const tiaOf = (p: number[]) => Math.exp(p[0]) / (lPhys + Math.exp(p[1]));
  const lam = lPhys + Math.exp(fit.p[1]);
  return {
    model: "mono",
    ok: fit.ok,
    tia: tiaOf(fit.p),
    tiaSd: deltaSd(fit.jac, fit.ssr, fit.p, tiaOf),
    teffH: LN2 / lam,
    aicc: aiccOf(fit.ssr, t.length, 2),
    curve: (ti) => f(fit.p, ti),
  };
}

/** A(t) = A·(e^{−λ1 t} − e^{−λ2 t}), λ1 = λ_phys + e^q1 (washout), λ2 = λ1 + e^q2 (uptake). */
export function fitBiUptake(t: number[], y: number[], o: TacOptions): TacFit {
  const lPhys = LN2 / o.physHalfLifeH;
  const lam1 = washoutRate(t, y, lPhys);
  const lam2 = Math.max(lam1 * 10, 3 / Math.max(t[0], 0.1));
  const l1 = (p: number[]) => lPhys + Math.exp(p[1]);
  const l2 = (p: number[]) => l1(p) + Math.exp(p[2]);
  const f = (p: number[], ti: number) => Math.exp(p[0]) * (Math.exp(-l1(p) * ti) - Math.exp(-l2(p) * ti));
  const peakIdx = y.indexOf(Math.max(...y));
  const shape = Math.exp(-lam1 * t[peakIdx]) - Math.exp(-lam2 * t[peakIdx]);
  const p0 = [Math.log(Math.max(y[peakIdx] / Math.max(shape, 1e-6), 1e-12)), Math.log(Math.max(lam1 - lPhys, lPhys * 1e-4)), Math.log(lam2 - lam1)];
  const fit = levenbergMarquardt(f, t, y, p0);
  const tiaOf = (p: number[]) => Math.exp(p[0]) * (1 / l1(p) - 1 / l2(p));
  const tia = tiaOf(fit.p);
  return {
    model: "biUptake",
    ok: fit.ok && Number.isFinite(tia) && tia > 0,
    tia,
    tiaSd: deltaSd(fit.jac, fit.ssr, fit.p, tiaOf),
    teffH: LN2 / l1(fit.p),
    aicc: aiccOf(fit.ssr, t.length, 3),
    curve: (ti) => f(fit.p, ti),
  };
}

/** Trapezoids from (0, 0) through the points, mono-exponential tail from the last points (≥ physical decay). */
export function trapezoid(t: number[], y: number[], o: TacOptions): TacFit {
  const lPhys = LN2 / o.physHalfLifeH;
  const xs = [0, ...t], ys = [0, ...y];
  let area = 0;
  for (let i = 1; i < xs.length; i++) area += ((ys[i] + ys[i - 1]) / 2) * (xs[i] - xs[i - 1]);
  const lam = t.length >= 2 ? washoutRate(t.slice(-2), y.slice(-2), lPhys) : lPhys;
  const last = y[y.length - 1], tl = t[t.length - 1];
  return {
    model: "trapezoid",
    ok: true,
    tia: area + last / lam,
    teffH: LN2 / lam,
    curve: (ti) => {
      if (ti >= tl) return last * Math.exp(-lam * (ti - tl));
      for (let i = 1; i < xs.length; i++) if (ti <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (ti - xs[i - 1])) / (xs[i] - xs[i - 1]);
      return 0;
    },
    note: "Aufnahme linear ab 0; Ausläufer aus den letzten zwei Punkten",
  };
}

/** Hänscheid et al.: TIA ≈ A(t)·2t/ln2 (exact for a mono-exponential washout with T_eff = t). */
export function hanscheid(tH: number, a: number): TacFit {
  const lam = LN2 / tH;
  return { model: "hanscheid", ok: tH > 0, tia: (a * 2 * tH) / LN2, teffH: tH, curve: (ti) => a * Math.exp(-lam * (ti - tH)), note: "Annahme T_eff ≈ Messzeitpunkt" };
}

/** Madsen et al.: TIA = A(t)·e^{λt}/λ with a population effective half-life. */
export function madsen(tH: number, a: number, teffH: number): TacFit {
  const lam = LN2 / teffH;
  return { model: "madsen", ok: tH > 0 && teffH > 0, tia: (a * Math.exp(lam * tH)) / lam, teffH, curve: (ti) => a * Math.exp(-lam * (ti - tH)), note: `Populations-T_eff ${teffH} h` };
}

/**
 * Fits a TAC with the requested model, or "auto": one point → Hänscheid (Madsen if T_eff is given),
 * two points → mono-exponential, three or more → bi-exponential with uptake when the activity still rises
 * between the first two points and the fit succeeds, else mono-exponential; with ≥ 5 points the
 * model with the lower AICc.
 */
export function fitTac(t: number[], y: number[], model: TacModel | "auto", o: TacOptions): TacFit {
  const order = t.map((_, i) => i).sort((a, b) => t[a] - t[b]);
  const ts = order.map((i) => t[i]), ys = order.map((i) => y[i]);
  const n = ts.length;
  if (n === 0) return { model: "mono", ok: false, tia: NaN, curve: () => NaN, note: "keine Messpunkte" };
  if (!ys.some((v) => v > 0)) return { model: "mono", ok: false, tia: 0, curve: () => 0, note: "keine Aktivität in der Region" };
  if (ys.some((v) => !(v > 0)) && model !== "trapezoid" && n > 1) {
    // Points without activity cannot be fitted on relative residuals: trapezoids instead.
    return { ...trapezoid(ts, ys.map((v) => Math.max(v, 0)), o), note: "Zeitpunkt(e) ohne Aktivität – Trapez statt Fit" };
  }
  if (model === "hanscheid" || (model === "auto" && n === 1 && !o.teffH)) return hanscheid(ts[n - 1], ys[n - 1]);
  if (model === "madsen" || (model === "auto" && n === 1)) return madsen(ts[n - 1], ys[n - 1], o.teffH ?? o.physHalfLifeH);
  if (n === 1) return { model: model === "auto" ? "mono" : model, ok: false, tia: NaN, curve: () => NaN, note: "Ein Zeitpunkt: Hänscheid oder Madsen wählen" };
  if (model === "trapezoid") return trapezoid(ts, ys, o);
  if (model === "mono") return fitMono(ts, ys, o);
  if (model === "biUptake") return n >= 3 ? fitBiUptake(ts, ys, o) : { ...fitMono(ts, ys, o), note: "Biexponentiell braucht ≥ 3 Zeitpunkte – monoexponentiell" };
  // auto
  const mono = fitMono(ts, ys, o);
  if (n < 3) return mono;
  const bi = fitBiUptake(ts, ys, o);
  if (!bi.ok) return mono;
  if (n >= 5 && mono.aicc !== undefined && bi.aicc !== undefined) return bi.aicc < mono.aicc ? bi : mono;
  return ys[1] > ys[0] ? bi : mono;
}

export interface ModelWeight {
  model: TacModel;
  aicc: number;
  /** Akaike weight wᵢ = exp(−Δᵢ/2) / Σ exp(−Δⱼ/2), Δᵢ = AICcᵢ − min AICc. */
  weight: number;
  tia: number;
}

/**
 * Akaike weights of the fit models that can be compared (AICc needs n > k + 1: mono from 4, bi-exponential from
 * 5 time points), with the model-averaged TIA. Empty when fewer than two models qualify.
 */
export function akaikeWeights(t: number[], y: number[], o: TacOptions): { weights: ModelWeight[]; averagedTia?: number } {
  if (t.length < 4 || y.some((v) => !(v > 0))) return { weights: [] };
  const order = t.map((_, i) => i).sort((a, b) => t[a] - t[b]);
  const ts = order.map((i) => t[i]), ys = order.map((i) => y[i]);
  const fits = [fitMono(ts, ys, o), fitBiUptake(ts, ys, o)].filter((f) => f.ok && f.aicc !== undefined && Number.isFinite(f.aicc));
  if (fits.length < 2) return { weights: [] };
  const min = Math.min(...fits.map((f) => f.aicc!));
  const raw = fits.map((f) => Math.exp(-(f.aicc! - min) / 2));
  const sum = raw.reduce((s, v) => s + v, 0);
  const weights = fits.map((f, i) => ({ model: f.model, aicc: f.aicc!, weight: raw[i] / sum, tia: f.tia }));
  return { weights, averagedTia: weights.reduce((s, w) => s + w.weight * w.tia, 0) };
}
