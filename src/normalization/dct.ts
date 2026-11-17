/**
 * Separable 3D discrete cosine transform (DCT-II) basis for smooth deformations, as used by SPM's
 * spm_normalise (Ashburner & Friston 1999). Basis functions are defined on the full template grid;
 * estimation samples them at a subset of voxel indices.
 */

/** Orthonormal 1D DCT-II basis: rows = sample indices (positions in the full grid of length n), cols = k. */
export function dctBasis(n: number, k: number, indices: number[]): Float64Array {
  const B = new Float64Array(indices.length * k);
  for (let s = 0; s < indices.length; s++) {
    const i = indices[s];
    for (let p = 0; p < k; p++) B[s * k + p] = p === 0 ? 1 / Math.sqrt(n) : Math.sqrt(2 / n) * Math.cos((Math.PI * p * (2 * i + 1)) / (2 * n));
  }
  return B;
}

/** Number of basis functions for a dimension (SPM: round(extent / cutoff), at least 1). */
export function basisCount(n: number, voxelMm: number, cutoffMm: number): number {
  return Math.max(1, Math.round((n * voxelMm) / cutoffMm));
}

/** Squared spatial frequency (mm⁻²) of basis p along an axis: second derivative eigenvalue. */
export function dctEigen(p: number, n: number, voxelMm: number): number {
  const w = (Math.PI * p) / (n * voxelMm);
  return w * w;
}

export interface Basis3 {
  /** 1D basis matrices (samples × k) per axis. */
  bx: Float64Array;
  by: Float64Array;
  bz: Float64Array;
  kx: number;
  ky: number;
  kz: number;
  /** Number of samples per axis. */
  nx: number;
  ny: number;
  nz: number;
}

/** Field (nx·ny·nz, x fastest) from coefficients c[(r·ky + q)·kx + p]. */
export function synthesize(b: Basis3, c: Float64Array | number[], out?: Float64Array): Float64Array {
  const { bx, by, bz, kx, ky, kz, nx, ny, nz } = b;
  // Pass 1: over r (z) → t1[(l·ky + q)·kx + p]
  const t1 = new Float64Array(nz * ky * kx);
  for (let l = 0; l < nz; l++)
    for (let r = 0; r < kz; r++) {
      const w = bz[l * kz + r];
      if (w === 0) continue;
      const src = r * ky * kx;
      const dst = l * ky * kx;
      for (let t = 0; t < ky * kx; t++) t1[dst + t] += w * c[src + t];
    }
  // Pass 2: over q (y) → t2[(l·ny + j)·kx + p]
  const t2 = new Float64Array(nz * ny * kx);
  for (let l = 0; l < nz; l++)
    for (let j = 0; j < ny; j++) {
      const dst = (l * ny + j) * kx;
      for (let q = 0; q < ky; q++) {
        const w = by[j * ky + q];
        const src = (l * ky + q) * kx;
        for (let p = 0; p < kx; p++) t2[dst + p] += w * t1[src + p];
      }
    }
  // Pass 3: over p (x)
  const res = out ?? new Float64Array(nx * ny * nz);
  for (let lj = 0; lj < nz * ny; lj++) {
    const src = lj * kx;
    const dst = lj * nx;
    for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let p = 0; p < kx; p++) s += bx[i * kx + p] * t2[src + p];
      res[dst + i] = s;
    }
  }
  return res;
}

/** Projection onto the basis: proj[k] = Σ_voxels f · B_k (adjoint of synthesize). */
export function project(b: Basis3, f: Float64Array | Float32Array): Float64Array {
  const { bx, by, bz, kx, ky, kz, nx, ny, nz } = b;
  // Over x: t2[(l·ny + j)·kx + p]
  const t2 = new Float64Array(nz * ny * kx);
  for (let lj = 0; lj < nz * ny; lj++) {
    const src = lj * nx;
    const dst = lj * kx;
    for (let i = 0; i < nx; i++) {
      const v = f[src + i];
      if (v === 0) continue;
      for (let p = 0; p < kx; p++) t2[dst + p] += v * bx[i * kx + p];
    }
  }
  // Over y: t1[(l·ky + q)·kx + p]
  const t1 = new Float64Array(nz * ky * kx);
  for (let l = 0; l < nz; l++)
    for (let j = 0; j < ny; j++) {
      const src = (l * ny + j) * kx;
      for (let q = 0; q < ky; q++) {
        const w = by[j * ky + q];
        const dst = (l * ky + q) * kx;
        for (let p = 0; p < kx; p++) t1[dst + p] += w * t2[src + p];
      }
    }
  // Over z
  const out = new Float64Array(kz * ky * kx);
  for (let l = 0; l < nz; l++)
    for (let r = 0; r < kz; r++) {
      const w = bz[l * kz + r];
      const src = l * ky * kx;
      const dst = r * ky * kx;
      for (let t = 0; t < ky * kx; t++) out[dst + t] += w * t1[src + t];
    }
  return out;
}

/**
 * Curvature matrix block Σ W · B_k · B_k' for all basis pairs (K × K, K = kx·ky·kz), computed slice by
 * slice with the separable structure (as in SPM's spm_brainwarp): O(nz·(nx·ny·ky² + nx·kx²·ky² + kz²·(kx·ky)²)).
 * The result is added into `A` (row stride `stride`) at offset (rowOff, colOff).
 */
export function addCurvature(b: Basis3, W: Float64Array, A: Float64Array, stride: number, rowOff: number, colOff: number): void {
  const { bx, by, bz, kx, ky, kz, nx, ny, nz } = b;
  const kxy = kx * ky;
  const T = new Float64Array(nx * ky * ky);
  const M = new Float64Array(kxy * kxy);
  for (let l = 0; l < nz; l++) {
    T.fill(0);
    // T[i][q][q'] = Σ_j W(i,j,l) By[j,q] By[j,q']
    for (let j = 0; j < ny; j++) {
      const rowW = (l * ny + j) * nx;
      for (let i = 0; i < nx; i++) {
        const w = W[rowW + i];
        if (w === 0) continue;
        const base = i * ky * ky;
        for (let q = 0; q < ky; q++) {
          const wq = w * by[j * ky + q];
          for (let q2 = 0; q2 < ky; q2++) T[base + q * ky + q2] += wq * by[j * ky + q2];
        }
      }
    }
    // M[(q,p),(q',p')] = Σ_i Bx[i,p] Bx[i,p'] T[i][q][q']
    M.fill(0);
    for (let i = 0; i < nx; i++) {
      const base = i * ky * ky;
      for (let p = 0; p < kx; p++) {
        const bp = bx[i * kx + p];
        if (bp === 0) continue;
        for (let p2 = 0; p2 < kx; p2++) {
          const bpp = bp * bx[i * kx + p2];
          for (let q = 0; q < ky; q++)
            for (let q2 = 0; q2 < ky; q2++) M[(q * kx + p) * kxy + q2 * kx + p2] += bpp * T[base + q * ky + q2];
        }
      }
    }
    // A[(r,·),(r',·)] += Bz[l,r] Bz[l,r'] M
    for (let r = 0; r < kz; r++) {
      const br = bz[l * kz + r];
      if (br === 0) continue;
      for (let r2 = 0; r2 < kz; r2++) {
        const brr = br * bz[l * kz + r2];
        for (let u = 0; u < kxy; u++) {
          const row = (rowOff + r * kxy + u) * stride + colOff + r2 * kxy;
          const mrow = u * kxy;
          for (let v = 0; v < kxy; v++) A[row + v] += brr * M[mrow + v];
        }
      }
    }
  }
}

/** In-place Cholesky solve of a symmetric positive definite system A x = b (A: n×n, row-major). */
export function choleskySolve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const L = A; // overwritten with the factor
  for (let j = 0; j < n; j++) {
    let d = L[j * n + j];
    for (let k = 0; k < j; k++) d -= L[j * n + k] * L[j * n + k];
    if (!(d > 0)) d = 1e-12;
    const ljj = Math.sqrt(d);
    L[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = L[i * n + j];
      const ri = i * n;
      const rj = j * n;
      for (let k = 0; k < j; k++) s -= L[ri + k] * L[rj + k];
      L[ri + j] = s / ljj;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}
