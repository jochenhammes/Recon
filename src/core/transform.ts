import { type Vec3, type WorldToVoxel, rotationMatrix } from "./geometry";

/**
 * Spatial transform between two datasets in patient (LPS) world coordinates, mm.
 *
 * A point p of the *moving* dataset is placed at p' = c + t + R·Z·H·(p − c) in the reference world,
 * with R = Rz·Ry·Rx (degrees), Z = diag(scale), H = upper-triangular shear and c the rotation center
 * (usually the moving volume's center). With scale 1 and shear 0 this is the rigid convention used by
 * the manual registration. Comparable to SPM's spm_matrix / FSL FLIRT's 12-parameter model.
 */
export interface TransformParams {
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
  /** Shear: x by y, x by z, y by z. */
  hxy: number;
  hxz: number;
  hyz: number;
}

export const IDENTITY_PARAMS: TransformParams = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, hxy: 0, hxz: 0, hyz: 0 };

/** Row-major 4×4 matrix. */
export type Mat4 = number[];

export const IDENTITY_MAT4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function isIdentityParams(p: TransformParams): boolean {
  return (Object.keys(IDENTITY_PARAMS) as (keyof TransformParams)[]).every((k) => p[k] === IDENTITY_PARAMS[k]);
}

export function isRigid(p: TransformParams): boolean {
  return p.sx === 1 && p.sy === 1 && p.sz === 1 && p.hxy === 0 && p.hxz === 0 && p.hyz === 0;
}

function mul3(a: number[], b: number[]): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

function apply3(m: number[], v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

/** Linear 3×3 part R·Z·H of the parameters. */
export function linearPart(p: TransformParams): number[] {
  const R = rotationMatrix(p.rx, p.ry, p.rz);
  const ZH = [p.sx, p.sx * p.hxy, p.sx * p.hxz, 0, p.sy, p.sy * p.hyz, 0, 0, p.sz];
  return mul3(R, ZH);
}

/** 4×4 matrix (moving world → reference world) from parameters about `center`. */
export function matrixFromParams(p: TransformParams, center: Vec3): Mat4 {
  const A = linearPart(p);
  const Ac = apply3(A, center);
  const b: Vec3 = [center[0] + p.tx - Ac[0], center[1] + p.ty - Ac[1], center[2] + p.tz - Ac[2]];
  return [A[0], A[1], A[2], b[0], A[3], A[4], A[5], b[1], A[6], A[7], A[8], b[2], 0, 0, 0, 1];
}

/**
 * Decomposes a matrix into parameters about `center` (QR decomposition of the linear part into
 * rotation × upper-triangular scale/shear). Returns null for reflections (negative determinant).
 */
export function paramsFromMatrix(M: Mat4, center: Vec3): TransformParams | null {
  const A = [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]];
  const col = (j: number): Vec3 => [A[j], A[3 + j], A[6 + j]];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] - s * b[0], a[1] - s * b[1], a[2] - s * b[2]];
  const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
  // Gram–Schmidt: A = Q·U with U upper triangular.
  const a0 = col(0), a1 = col(1), a2 = col(2);
  const u00 = len(a0);
  const q0: Vec3 = [a0[0] / u00, a0[1] / u00, a0[2] / u00];
  const u01 = dot(q0, a1);
  const v1 = sub(a1, q0, u01);
  const u11 = len(v1);
  const q1: Vec3 = [v1[0] / u11, v1[1] / u11, v1[2] / u11];
  const u02 = dot(q0, a2);
  const u12 = dot(q1, a2);
  const v2 = sub(sub(a2, q0, u02), q1, u12);
  const u22 = len(v2);
  const q2: Vec3 = [v2[0] / u22, v2[1] / u22, v2[2] / u22];
  const R = [q0[0], q1[0], q2[0], q0[1], q1[1], q2[1], q0[2], q1[2], q2[2]];
  const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
  if (!(u00 > 0 && u11 > 0 && u22 > 0) || det < 0) return null;
  // R = Rz·Ry·Rx → Euler angles.
  const ry = Math.asin(Math.max(-1, Math.min(1, -R[6])));
  const rx = Math.atan2(R[7], R[8]);
  const rz = Math.atan2(R[3], R[0]);
  const deg = 180 / Math.PI;
  const Ac = apply3(A, center);
  return {
    tx: M[3] - center[0] + Ac[0],
    ty: M[7] - center[1] + Ac[1],
    tz: M[11] - center[2] + Ac[2],
    rx: rx * deg,
    ry: ry * deg,
    rz: rz * deg,
    sx: u00,
    sy: u11,
    sz: u22,
    hxy: u01 / u00,
    hxz: u02 / u00,
    hyz: u12 / u11,
  };
}

export function multiply4(a: Mat4, b: Mat4): Mat4 {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
}

/** Inverse of an affine 4×4 matrix (last row 0 0 0 1). */
export function invert4(M: Mat4): Mat4 {
  const [a, b, c, , d, e, f, , g, h, i] = M;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error("Transformation ist nicht invertierbar.");
  const inv = [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
  const t = apply3(inv, [M[3], M[7], M[11]]);
  return [inv[0], inv[1], inv[2], -t[0], inv[3], inv[4], inv[5], -t[1], inv[6], inv[7], inv[8], -t[2], 0, 0, 0, 1];
}

export function applyMat4(M: Mat4, p: Vec3): Vec3 {
  return [
    M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[3],
    M[4] * p[0] + M[5] * p[1] + M[6] * p[2] + M[7],
    M[8] * p[0] + M[9] * p[1] + M[10] * p[2] + M[11],
  ];
}

export function isIdentityMat4(M: Mat4): boolean {
  return M.every((v, i) => Math.abs(v - IDENTITY_MAT4[i]) < 1e-12);
}

/**
 * World→voxel transform of a moving volume displayed in the reference world via M (moving → reference):
 * the voxel shown at reference point p is the moving voxel at M⁻¹·p.
 */
export function transformedWorldToVoxel(base: WorldToVoxel, M: Mat4): WorldToVoxel {
  if (isIdentityMat4(M)) return base;
  const Minv = invert4(M);
  const Ainv = [Minv[0], Minv[1], Minv[2], Minv[4], Minv[5], Minv[6], Minv[8], Minv[9], Minv[10]];
  const A = [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]];
  const Ao = apply3(A, base.origin);
  return { m: mul3(base.m, Ainv), origin: [M[3] + Ao[0], M[7] + Ao[1], M[11] + Ao[2]] };
}

// ─── JSON ────────────────────────────────────────────────────────────────────

export interface TransformFile {
  format: "recon-studio-transform";
  version: 1;
  /** Maps moving world (LPS, mm) to reference world: p_ref = matrix · p_moving. Row-major 4×4. */
  matrix: Mat4;
  params: TransformParams;
  center: Vec3;
  moving: { name: string; frameOfReferenceUid?: string };
  reference: { name: string; frameOfReferenceUid?: string };
  method?: string;
  cost?: { name: string; before?: number; after?: number };
  created: string;
}

export function parseTransformFile(text: string): TransformFile {
  const data = JSON.parse(text) as Partial<TransformFile>;
  if (data.format !== "recon-studio-transform" || !Array.isArray(data.matrix) || data.matrix.length !== 16 || !data.matrix.every(Number.isFinite))
    throw new Error("Keine gültige Recon-Studio-Transformationsdatei.");
  return data as TransformFile;
}
