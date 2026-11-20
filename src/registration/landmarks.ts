import type { Vec3, VolumeGeometry } from "../core/geometry";
import { IDENTITY_MAT4, type Mat4, applyMat4, invert4, multiply4, transformGeometry } from "../core/transform";

/** A named anatomical landmark in the native (own) world coordinates of a dataset. */
export interface Landmark {
  name: string;
  p: Vec3;
}

/** The two landmarks set in every dataset (pairs are formed by name). */
export const LANDMARK_1 = "Landmarke 1";
export const LANDMARK_2 = "Landmarke 2";

export const translation = (t: Vec3): Mat4 => [1, 0, 0, t[0], 0, 1, 0, t[1], 0, 0, 1, t[2], 0, 0, 0, 1];

/**
 * Moves a placement so that the moving landmark lands on the base landmark: M'·lMov = lBase (reference world).
 * The linear part (rotation, scaling) of M is kept.
 */
export function alignByLandmark(lBase: Vec3, lMov: Vec3, M: Mat4): Mat4 {
  const q = applyMat4(M, lMov);
  const out = [...M];
  out[3] += lBase[0] - q[0];
  out[7] += lBase[1] - q[1];
  out[11] += lBase[2] - q[2];
  return out;
}

/** Translation that puts a point at (0, 0, 0). */
export function originShift(l: Vec3): Mat4 {
  return translation([-l[0], -l[1], -l[2]]);
}

export interface RigidFit {
  matrix: Mat4;
  /** Root mean square distance of the mapped points (mm). */
  rms: number;
  residuals: number[];
}

/**
 * Least-squares rigid transform (rotation + translation, no reflection) mapping `from` onto `to`
 * (Horn 1987, unit quaternions). Needs ≥ 3 non-collinear point pairs; null otherwise.
 */
export function rigidFromPairs(pairs: { from: Vec3; to: Vec3 }[]): RigidFit | null {
  const n = pairs.length;
  if (n < 3) return null;
  const mean = (sel: (p: { from: Vec3; to: Vec3 }) => Vec3): Vec3 => {
    const s: Vec3 = [0, 0, 0];
    for (const p of pairs) for (let a = 0; a < 3; a++) s[a] += sel(p)[a] / n;
    return s;
  };
  const cf = mean((p) => p.from), ct = mean((p) => p.to);
  // Collinearity: second singular value of the centered source points.
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pairs) {
    const d = [p.from[0] - cf[0], p.from[1] - cf[1], p.from[2] - cf[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j] += d[i] * d[j];
  }
  const ev = jacobiEigen(cov, 3).values.sort((a, b) => b - a);
  if (!(ev[0] > 0) || ev[1] / ev[0] < 1e-6) return null;
  // Cross-covariance S = Σ (from − cf)(to − ct)ᵀ.
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pairs) {
    const a = [p.from[0] - cf[0], p.from[1] - cf[1], p.from[2] - cf[2]];
    const b = [p.to[0] - ct[0], p.to[1] - ct[1], p.to[2] - ct[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i * 3 + j] += a[i] * b[j];
  }
  const [Sxx, Sxy, Sxz, Syx, Syy, Syz, Szx, Szy, Szz] = S;
  const N = [
    Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx,
    Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz,
    Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy,
    Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz,
  ];
  const { values, vectors } = jacobiEigen(N, 4);
  let best = 0;
  for (let i = 1; i < 4; i++) if (values[i] > values[best]) best = i;
  const [w, x, y, z] = [0, 1, 2, 3].map((r) => vectors[r * 4 + best]);
  const R = [
    w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z,
  ];
  const Rc = [R[0] * cf[0] + R[1] * cf[1] + R[2] * cf[2], R[3] * cf[0] + R[4] * cf[1] + R[5] * cf[2], R[6] * cf[0] + R[7] * cf[1] + R[8] * cf[2]];
  const matrix: Mat4 = [R[0], R[1], R[2], ct[0] - Rc[0], R[3], R[4], R[5], ct[1] - Rc[1], R[6], R[7], R[8], ct[2] - Rc[2], 0, 0, 0, 1];
  const residuals = pairs.map((p) => {
    const q = applyMat4(matrix, p.from);
    return Math.hypot(q[0] - p.to[0], q[1] - p.to[1], q[2] - p.to[2]);
  });
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n);
  return { matrix, rms, residuals };
}

/** Eigen decomposition of a symmetric n×n matrix (row-major) by cyclic Jacobi rotations; vectors in columns. */
function jacobiEigen(Ain: number[], n: number): { values: number[]; vectors: number[] } {
  const A = [...Ain];
  const V: number[] = Array.from({ length: n * n }, (_, i) => (i % (n + 1) === 0 ? 1 : 0));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (A[q * n + q] - A[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p], akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k], aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p], vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
  }
  return { values: Array.from({ length: n }, (_, i) => A[i * n + i]), vectors: V };
}

/** Landmark pairs by name: moving native → base reference world (base landmark mapped through the base placement). */
export function landmarkPairs(base: Landmark[], baseMatrix: Mat4, moving: Landmark[]): { name: string; from: Vec3; to: Vec3 }[] {
  const out: { name: string; from: Vec3; to: Vec3 }[] = [];
  for (const m of moving) {
    const b = base.find((x) => x.name === m.name);
    if (b) out.push({ name: m.name, from: m.p, to: applyMat4(baseMatrix, b.p) });
  }
  return out;
}

export interface Placement {
  id: string;
  matrix: Mat4;
  geometry: VolumeGeometry;
  landmarks?: Landmark[];
}

export interface ReorientResult {
  matrices: Map<string, Mat4>;
  geometries: Map<string, VolumeGeometry>;
  landmarks: Map<string, Landmark[]>;
  /** Change of the reference world (T if the base was reoriented, else identity): cursor etc. follow. */
  world: Mat4;
}

/**
 * Takes a coordinate change T (native → new native, e.g. "landmark becomes the origin") into the datasets
 * `targets`: their geometry and landmarks are transformed, and all placements are compensated so that the
 * datasets stay aligned to each other (M' = W·M·T⁻¹ for targets, W·M for the others; W = T if the base is a target).
 */
export function reorientPlan(items: Placement[], targets: Set<string>, T: Mat4, baseId: string): ReorientResult {
  const W = targets.has(baseId) ? T : IDENTITY_MAT4;
  const Tinv = invert4(T);
  const matrices = new Map<string, Mat4>();
  const geometries = new Map<string, VolumeGeometry>();
  const landmarks = new Map<string, Landmark[]>();
  for (const it of items) {
    if (targets.has(it.id)) {
      matrices.set(it.id, multiply4(multiply4(W, it.matrix), Tinv));
      geometries.set(it.id, transformGeometry(it.geometry, T));
      if (it.landmarks) landmarks.set(it.id, it.landmarks.map((l) => ({ ...l, p: applyMat4(T, l.p) })));
    } else matrices.set(it.id, multiply4(W, it.matrix));
  }
  return { matrices, geometries, landmarks, world: W };
}

/** Deterministic DICOM UID (2.25.…) for a frame of reference after a coordinate change. */
export function derivedFrameOfReference(oldUid: string | undefined, T: Mat4): string {
  const text = `${oldUid ?? "none"}|${T.map((v) => v.toFixed(4)).join(",")}`;
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  // Two rounds for ~128 bits of spread; 2.25 UIDs are decimal integers without leading zeros.
  let h2 = h ^ 0x9e3779b97f4a7c15n;
  for (let i = 0; i < text.length; i++) {
    h2 ^= BigInt(text.charCodeAt(text.length - 1 - i));
    h2 = (h2 * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `2.25.${((h << 64n) | h2) + 1n}`;
}

/**
 * Two landmarks: landmark 1 is moved onto the base landmark 1, and the dataset is turned about it with the smallest
 * rotation that makes the direction 1 → 2 match the base (the roll about this axis stays as it was).
 */
export function alignTwoLandmarks(b1: Vec3, b2: Vec3, m1: Vec3, m2: Vec3, M: Mat4): Mat4 | null {
  const A = [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]];
  const d: Vec3 = [m2[0] - m1[0], m2[1] - m1[1], m2[2] - m1[2]];
  const vm: Vec3 = [A[0] * d[0] + A[1] * d[1] + A[2] * d[2], A[3] * d[0] + A[4] * d[1] + A[5] * d[2], A[6] * d[0] + A[7] * d[1] + A[8] * d[2]];
  const vb: Vec3 = [b2[0] - b1[0], b2[1] - b1[1], b2[2] - b1[2]];
  const lm = Math.hypot(...vm), lb = Math.hypot(...vb);
  if (lm < 1e-6 || lb < 1e-6) return null;
  const a: Vec3 = [vm[0] / lm, vm[1] / lm, vm[2] / lm], b: Vec3 = [vb[0] / lb, vb[1] / lb, vb[2] / lb];
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let axis: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let s = Math.hypot(...axis);
  if (s < 1e-9) {
    if (c > 0) axis = [1, 0, 0];
    else {
      // Opposite directions: any axis perpendicular to a, 180°.
      const p: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      axis = [a[1] * p[2] - a[2] * p[1], a[2] * p[0] - a[0] * p[2], a[0] * p[1] - a[1] * p[0]];
    }
    s = c > 0 ? 0 : 1;
    const n = Math.hypot(...axis);
    axis = [axis[0] / n, axis[1] / n, axis[2] / n];
  } else axis = [axis[0] / s, axis[1] / s, axis[2] / s];
  const [x, y, z] = axis, C = 1 - c;
  // Rodrigues: rotation by angle (cos c, sin s) about the axis.
  const R = [
    c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C,
  ];
  const RA = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => R[i * 3] * A[j] + R[i * 3 + 1] * A[3 + j] + R[i * 3 + 2] * A[6 + j]));
  const q = [RA[0] * m1[0] + RA[1] * m1[1] + RA[2] * m1[2], RA[3] * m1[0] + RA[4] * m1[1] + RA[5] * m1[2], RA[6] * m1[0] + RA[7] * m1[1] + RA[8] * m1[2]];
  return [RA[0], RA[1], RA[2], b1[0] - q[0], RA[3], RA[4], RA[5], b1[1] - q[1], RA[6], RA[7], RA[8], b1[2] - q[2], 0, 0, 0, 1];
}
