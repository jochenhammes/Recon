import { quickselect } from "../analysis/stats";
import { type Vec3, voxelToWorld, worldToVoxelTransform } from "../core/geometry";
import { type Mat4, invert4 } from "../core/transform";
import { gaussianSmooth } from "../edit/filters";
import { Volume3D } from "../viewer/volume";
import { type Basis3, addCurvature, basisCount, choleskySolve, dctBasis, dctEigen, project, synthesize } from "./dct";

/**
 * Nonlinear spatial normalization after SPM "Normalise (Estimate)" (Ashburner & Friston 1999):
 * on top of an affine subject→template transform, a smooth displacement d(x) (template world, mm) made
 * of low-frequency 3D DCT basis functions is estimated so that the (smoothed) subject, sampled at
 * A⁻¹(x + d(x)), matches the (smoothed) template after an intensity scaling s·f + b. The sum of squared
 * differences is minimized with a regularized (bending energy) Gauss–Newton / Levenberg–Marquardt scheme.
 */
export interface WarpOptions {
  /** Shortest wavelength of the basis functions (SPM default 25 mm). */
  cutoffMm: number;
  /** Regularization strength relative to the data term (light ≈ 0.01, medium ≈ 0.1, heavy ≈ 1). */
  regularization: number;
  iterations: number;
  /** Smoothing of both images (FWHM, mm) before matching (SPM default 8 mm). */
  fwhmMm: number;
  /** Sampling step on the template grid (voxels). */
  sampleStep: number;
}

export const DEFAULT_WARP: WarpOptions = { cutoffMm: 30, regularization: 0.1, iterations: 16, fwhmMm: 8, sampleStep: 2 };

export interface WarpInput {
  template: { data: Float32Array; dims: Vec3; geometry: Volume3D["geometry"] };
  subject: { data: Float32Array; dims: Vec3; geometry: Volume3D["geometry"] };
  /** Subject → template world (the affine normalization). */
  affine: Mat4;
  /** Optional weights on the template grid (e.g. brain mask). */
  weights?: Float32Array;
}

export interface WarpProgress {
  iteration: number;
  iterations: number;
  cost: number;
}

export interface WarpResult {
  /** Pull-back field on the full template grid: subject world position (LPS mm), xyz interleaved. */
  field: Float32Array;
  costBefore: number;
  costAfter: number;
  /** Fraction of template voxels (within weights > 0.5) with a non-positive Jacobian determinant. */
  foldedFraction: number;
  maxDisplacementMm: number;
}

function toVolume(img: WarpInput["template"]): Volume3D {
  const [nx, ny, nz] = img.dims;
  const g = img.geometry;
  return new Volume3D(img.data, nz, ny, nx, [g.spacing[2], g.spacing[1], g.spacing[0]], g);
}

/** Robust scaling to ~0..1 (99.5th percentile of positive values → 1). */
function normalizeIntensity(v: Volume3D): Volume3D {
  const stride = Math.max(1, Math.floor(v.data.length / 500_000));
  const vals: number[] = [];
  for (let i = 0; i < v.data.length; i += stride) if (v.data[i] > 0) vals.push(v.data[i]);
  const arr = Float32Array.from(vals.length ? vals : [1]);
  const hi = quickselect(arr, Math.floor(0.995 * (arr.length - 1))) || 1;
  const out = new Float32Array(v.data.length);
  for (let i = 0; i < out.length; i++) {
    const x = v.data[i];
    out[i] = x === x ? x / hi : 0;
  }
  return v.withData(out);
}

/** Trilinear value and gradient (in voxel units) at continuous voxel position; null outside. */
function sampleWithGradient(vol: Volume3D, x: number, y: number, z: number, g: Float64Array): number | null {
  const { nx, ny, nz, data } = vol;
  if (x < 0 || y < 0 || z < 0 || x > nx - 1 || y > ny - 1 || z > nz - 1) return null;
  const x0 = Math.min(Math.floor(x), nx - 2 < 0 ? 0 : nx - 2);
  const y0 = Math.min(Math.floor(y), ny - 2 < 0 ? 0 : ny - 2);
  const z0 = Math.min(Math.floor(z), nz - 2 < 0 ? 0 : nz - 2);
  const x1 = Math.min(x0 + 1, nx - 1), y1 = Math.min(y0 + 1, ny - 1), z1 = Math.min(z0 + 1, nz - 1);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const s = nx * ny;
  const v000 = data[z0 * s + y0 * nx + x0], v100 = data[z0 * s + y0 * nx + x1];
  const v010 = data[z0 * s + y1 * nx + x0], v110 = data[z0 * s + y1 * nx + x1];
  const v001 = data[z1 * s + y0 * nx + x0], v101 = data[z1 * s + y0 * nx + x1];
  const v011 = data[z1 * s + y1 * nx + x0], v111 = data[z1 * s + y1 * nx + x1];
  const c00 = v000 + (v100 - v000) * fx, c10 = v010 + (v110 - v010) * fx;
  const c01 = v001 + (v101 - v001) * fx, c11 = v011 + (v111 - v011) * fx;
  const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
  g[0] = ((v100 - v000) * (1 - fy) + (v110 - v010) * fy) * (1 - fz) + ((v101 - v001) * (1 - fy) + (v111 - v011) * fy) * fz;
  g[1] = (c10 - c00) * (1 - fz) + (c11 - c01) * fz;
  g[2] = c1 - c0;
  return c0 + (c1 - c0) * fz;
}

export function estimateWarp(input: WarpInput, opts: WarpOptions = DEFAULT_WARP, onProgress?: (p: WarpProgress) => void, shouldStop?: () => boolean): WarpResult {
  const templateRaw = toVolume(input.template);
  const subjectRaw = toVolume(input.subject);
  const tpl = normalizeIntensity(templateRaw.withData(gaussianSmooth(templateRaw, opts.fwhmMm)));
  const sub = normalizeIntensity(subjectRaw.withData(gaussianSmooth(subjectRaw, opts.fwhmMm)));
  const { nx: NX, ny: NY, nz: NZ } = tpl;
  const tg = tpl.geometry;
  const step = Math.max(1, Math.round(opts.sampleStep));
  const ix: number[] = [], iy: number[] = [], iz: number[] = [];
  for (let i = Math.floor(step / 2); i < NX; i += step) ix.push(i);
  for (let j = Math.floor(step / 2); j < NY; j += step) iy.push(j);
  for (let k = Math.floor(step / 2); k < NZ; k += step) iz.push(k);
  const kx = basisCount(NX, tg.spacing[0], opts.cutoffMm);
  const ky = basisCount(NY, tg.spacing[1], opts.cutoffMm);
  const kz = basisCount(NZ, tg.spacing[2], opts.cutoffMm);
  const basis: Basis3 = { bx: dctBasis(NX, kx, ix), by: dctBasis(NY, ky, iy), bz: dctBasis(NZ, kz, iz), kx, ky, kz, nx: ix.length, ny: iy.length, nz: iz.length };
  const K = kx * ky * kz;
  const P = 3 * K + 2; // 3 displacement fields + scale + offset
  const N = ix.length * iy.length * iz.length;

  // Sample data: template world positions, template values, weights.
  const X = new Float64Array(3 * N);
  const G = new Float64Array(N);
  const W0 = new Float64Array(N);
  let s = 0;
  for (const k of iz)
    for (const j of iy)
      for (const i of ix) {
        const p = voxelToWorld(tg, i, j, k);
        X[3 * s] = p[0];
        X[3 * s + 1] = p[1];
        X[3 * s + 2] = p[2];
        const idx = (k * NY + j) * NX + i;
        G[s] = tpl.data[idx];
        W0[s] = input.weights ? (input.weights[idx] > 0.5 ? 1 : 0) : 1;
        s++;
      }

  // Subject voxel = Mv · (x + d) + tv  (template world → subject world via A⁻¹, then subject w2v).
  const Ainv = invert4(input.affine);
  const w2v = worldToVoxelTransform(sub.geometry);
  const m = w2v.m;
  const AL = [Ainv[0], Ainv[1], Ainv[2], Ainv[4], Ainv[5], Ainv[6], Ainv[8], Ainv[9], Ainv[10]];
  const Mv = new Float64Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Mv[r * 3 + c] = m[r * 3] * AL[c] + m[r * 3 + 1] * AL[3 + c] + m[r * 3 + 2] * AL[6 + c];
  const at = [Ainv[3] - w2v.origin[0], Ainv[7] - w2v.origin[1], Ainv[11] - w2v.origin[2]];
  const tv = [m[0] * at[0] + m[1] * at[1] + m[2] * at[2], m[3] * at[0] + m[4] * at[1] + m[5] * at[2], m[6] * at[0] + m[7] * at[1] + m[8] * at[2]];

  // Bending-energy prior (diagonal for the orthonormal DCT basis): (λx + λy + λz)².
  const H = new Float64Array(K);
  for (let r = 0; r < kz; r++)
    for (let q = 0; q < ky; q++)
      for (let p = 0; p < kx; p++) {
        const e = dctEigen(p, NX, tg.spacing[0]) + dctEigen(q, NY, tg.spacing[1]) + dctEigen(r, NZ, tg.spacing[2]);
        H[(r * ky + q) * kx + p] = e * e;
      }

  let theta = new Float64Array(P);
  theta[3 * K] = 1; // scale
  const dx = new Float64Array(N), dy = new Float64Array(N), dz = new Float64Array(N);
  const grad = new Float64Array(3);
  const F = new Float64Array(N);
  const J = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
  const Wv = new Float64Array(N);
  let lambda = 0;

  /** Data term and Jacobians at θ; returns Σ w r² (and fills F, J, Wv, residuals). */
  const R = new Float64Array(N);
  const evaluate = (th: Float64Array, withJ: boolean): number => {
    synthesize(basis, th.subarray(0, K), dx);
    synthesize(basis, th.subarray(K, 2 * K), dy);
    synthesize(basis, th.subarray(2 * K, 3 * K), dz);
    const sc = th[3 * K];
    const off = th[3 * K + 1];
    let ssd = 0;
    for (let n = 0; n < N; n++) {
      if (W0[n] === 0) {
        Wv[n] = 0;
        continue;
      }
      const px = X[3 * n] + dx[n], py = X[3 * n + 1] + dy[n], pz = X[3 * n + 2] + dz[n];
      const vx = Mv[0] * px + Mv[1] * py + Mv[2] * pz + tv[0];
      const vy = Mv[3] * px + Mv[4] * py + Mv[5] * pz + tv[1];
      const vz = Mv[6] * px + Mv[7] * py + Mv[8] * pz + tv[2];
      const f = sampleWithGradient(sub, vx, vy, vz, grad);
      if (f === null) {
        Wv[n] = 0;
        continue;
      }
      Wv[n] = W0[n];
      F[n] = f;
      const r = sc * f + off - G[n];
      R[n] = r;
      ssd += W0[n] * r * r;
      if (withJ)
        for (let c = 0; c < 3; c++) J[c][n] = sc * (grad[0] * Mv[c] + grad[1] * Mv[3 + c] + grad[2] * Mv[6 + c]);
    }
    return ssd;
  };
  const prior = (th: Float64Array) => {
    let e = 0;
    for (let c = 0; c < 3; c++) for (let k = 0; k < K; k++) e += H[k] * th[c * K + k] ** 2;
    return lambda * e;
  };

  let ssd = evaluate(theta, true);
  const costBefore = ssd;
  let mu = 1e-3;
  for (let it = 0; it < opts.iterations; it++) {
    if (shouldStop?.()) break;
    // Normal equations: A = Jᵀ W J (+ intensity terms), b = −(Jᵀ W r + λ H θ)
    const A = new Float64Array(P * P);
    const WJJ = new Float64Array(N);
    for (let a = 0; a < 3; a++)
      for (let c = a; c < 3; c++) {
        for (let n = 0; n < N; n++) WJJ[n] = Wv[n] * J[a][n] * J[c][n];
        addCurvature(basis, WJJ, A, P, a * K, c * K);
      }
    // Intensity parameter columns: ∂r/∂s = f, ∂r/∂b = 1.
    const wf = new Float64Array(N), w1 = new Float64Array(N), wr = new Float64Array(N);
    let sff = 0, sf = 0, s1 = 0, sfr = 0, sr = 0;
    for (let n = 0; n < N; n++) {
      const w = Wv[n];
      if (w === 0) continue;
      sff += w * F[n] * F[n];
      sf += w * F[n];
      s1 += w;
      sfr += w * F[n] * R[n];
      sr += w * R[n];
    }
    const b = new Float64Array(P);
    for (let c = 0; c < 3; c++) {
      for (let n = 0; n < N; n++) {
        const wj = Wv[n] * J[c][n];
        wf[n] = wj * F[n];
        w1[n] = wj;
        wr[n] = wj * R[n];
      }
      const pf = project(basis, wf);
      const p1 = project(basis, w1);
      const pr = project(basis, wr);
      for (let k = 0; k < K; k++) {
        A[(c * K + k) * P + 3 * K] = pf[k];
        A[(c * K + k) * P + 3 * K + 1] = p1[k];
        b[c * K + k] = -pr[k];
      }
    }
    A[3 * K * P + 3 * K] = sff;
    A[3 * K * P + 3 * K + 1] = sf;
    A[(3 * K + 1) * P + 3 * K + 1] = s1;
    b[3 * K] = -sfr;
    b[3 * K + 1] = -sr;
    // Symmetrize (upper blocks were filled).
    for (let i = 0; i < P; i++) for (let j = i + 1; j < P; j++) A[j * P + i] = A[i * P + j];
    // Regularization weight relative to the data curvature (first iteration).
    if (it === 0) {
      let dsum = 0;
      for (let i = 0; i < 3 * K; i++) dsum += A[i * P + i];
      const hs = Float64Array.from(H).sort();
      const hMed = hs[Math.floor(hs.length / 2)] || 1;
      lambda = (opts.regularization * dsum) / (3 * K) / hMed;
    }
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < K; k++) {
        A[(c * K + k) * P + c * K + k] += lambda * H[k];
        b[c * K + k] -= lambda * H[k] * theta[c * K + k];
      }
    const current = ssd + prior(theta);
    // Levenberg–Marquardt: increase damping until the cost decreases.
    let accepted = false;
    for (let attempt = 0; attempt < 6 && !accepted; attempt++) {
      const Ad = Float64Array.from(A);
      for (let i = 0; i < P; i++) Ad[i * P + i] *= 1 + mu;
      const delta = choleskySolve(Ad, b, P);
      const cand = new Float64Array(P);
      for (let i = 0; i < P; i++) cand[i] = theta[i] + delta[i];
      const candSsd = evaluate(cand, false);
      if (candSsd + prior(cand) < current) {
        theta = cand;
        mu = Math.max(1e-6, mu / 3);
        accepted = true;
      } else mu *= 10;
    }
    ssd = evaluate(theta, true);
    onProgress?.({ iteration: it + 1, iterations: opts.iterations, cost: ssd });
    if (!accepted) break;
  }

  // Full-resolution pull-back field y(x) = A⁻¹(x + d(x)).
  const full: Basis3 = {
    bx: dctBasis(NX, kx, [...Array(NX).keys()]),
    by: dctBasis(NY, ky, [...Array(NY).keys()]),
    bz: dctBasis(NZ, kz, [...Array(NZ).keys()]),
    kx, ky, kz, nx: NX, ny: NY, nz: NZ,
  };
  const fdx = synthesize(full, theta.subarray(0, K));
  const fdy = synthesize(full, theta.subarray(K, 2 * K));
  const fdz = synthesize(full, theta.subarray(2 * K, 3 * K));
  const field = new Float32Array(NX * NY * NZ * 3);
  let maxDisp = 0;
  for (let k = 0, o = 0; k < NZ; k++)
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++, o++) {
        const p = voxelToWorld(tg, i, j, k);
        const qx = p[0] + fdx[o], qy = p[1] + fdy[o], qz = p[2] + fdz[o];
        field[3 * o] = Ainv[0] * qx + Ainv[1] * qy + Ainv[2] * qz + Ainv[3];
        field[3 * o + 1] = Ainv[4] * qx + Ainv[5] * qy + Ainv[6] * qz + Ainv[7];
        field[3 * o + 2] = Ainv[8] * qx + Ainv[9] * qy + Ainv[10] * qz + Ainv[11];
        maxDisp = Math.max(maxDisp, Math.hypot(fdx[o], fdy[o], fdz[o]));
      }
  return { field, costBefore, costAfter: ssd, foldedFraction: foldedFraction(fdx, fdy, fdz, NX, NY, NZ, tg.spacing, input.weights), maxDisplacementMm: maxDisp };
}

/** Fraction of voxels where det(I + ∇d) ≤ 0 (folding), by central differences. */
function foldedFraction(dx: Float64Array, dy: Float64Array, dz: Float64Array, nx: number, ny: number, nz: number, sp: Vec3, weights?: Float32Array): number {
  let bad = 0;
  let n = 0;
  const id = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const o = id(i, j, k);
        if (weights && !(weights[o] > 0.5)) continue;
        const d = (f: Float64Array, a: 0 | 1 | 2) => {
          const [p, q] = a === 0 ? [id(i + 1, j, k), id(i - 1, j, k)] : a === 1 ? [id(i, j + 1, k), id(i, j - 1, k)] : [id(i, j, k + 1), id(i, j, k - 1)];
          return (f[p] - f[q]) / (2 * sp[a]);
        };
        const m = [1 + d(dx, 0), d(dx, 1), d(dx, 2), d(dy, 0), 1 + d(dy, 1), d(dy, 2), d(dz, 0), d(dz, 1), 1 + d(dz, 2)];
        const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
        n++;
        if (det <= 0) bad++;
      }
  return n ? bad / n : 0;
}
