import { t } from "../i18n";
/**
 * Patient-space geometry of a voxel volume, in DICOM LPS coordinates (mm):
 * +x = patient left, +y = posterior, +z = head (superior).
 *
 * world(i, j, k) = origin + axes[0]·i·spacing[0] + axes[1]·j·spacing[1] + axes[2]·k·spacing[2]
 * with i = column (x index), j = row (y index), k = slice (z index), voxel centers at integers.
 */
export type Vec3 = [number, number, number];

export interface VolumeGeometry {
  /** World position of the center of voxel (0, 0, 0). */
  origin: Vec3;
  /** Unit direction vectors of the x (column), y (row) and z (slice) index axes. */
  axes: [Vec3, Vec3, Vec3];
  /** Voxel size along the x, y, z index axes in mm. */
  spacing: Vec3;
  frameOfReferenceUid?: string;
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  return n > 0 ? scale(a, 1 / n) : [0, 0, 0];
}

/** Axis-aligned geometry at the origin (used when no patient coordinates are known). */
export function identityGeometry(spacing: Vec3): VolumeGeometry {
  return {
    origin: [0, 0, 0],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    spacing,
  };
}

export function voxelToWorld(g: VolumeGeometry, i: number, j: number, k: number): Vec3 {
  const [a, b, c] = g.axes;
  const [sx, sy, sz] = g.spacing;
  return [
    g.origin[0] + a[0] * i * sx + b[0] * j * sy + c[0] * k * sz,
    g.origin[1] + a[1] * i * sx + b[1] * j * sy + c[1] * k * sz,
    g.origin[2] + a[2] * i * sx + b[2] * j * sy + c[2] * k * sz,
  ];
}

/** 3×3 matrix (row-major) mapping index offsets to world offsets: columns are axes·spacing. */
export function indexToWorldMatrix(g: VolumeGeometry): number[] {
  const [a, b, c] = g.axes;
  const [sx, sy, sz] = g.spacing;
  return [a[0] * sx, b[0] * sy, c[0] * sz, a[1] * sx, b[1] * sy, c[1] * sz, a[2] * sx, b[2] * sy, c[2] * sz];
}

export function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error(t("Singuläre Volumengeometrie."));
  const inv = 1 / det;
  return [
    A * inv,
    -(b * i - c * h) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    -(a * f - c * d) * inv,
    C * inv,
    -(a * h - b * g) * inv,
    (a * e - b * d) * inv,
  ];
}

/** Precomputed world→continuous voxel index transform (for fast repeated sampling). */
export interface WorldToVoxel {
  m: number[];
  origin: Vec3;
}

export function worldToVoxelTransform(g: VolumeGeometry): WorldToVoxel {
  return { m: invert3(indexToWorldMatrix(g)), origin: g.origin };
}

export function applyWorldToVoxel(t: WorldToVoxel, p: Vec3): Vec3 {
  const x = p[0] - t.origin[0];
  const y = p[1] - t.origin[1];
  const z = p[2] - t.origin[2];
  const m = t.m;
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

export function worldToVoxel(g: VolumeGeometry, p: Vec3): Vec3 {
  return applyWorldToVoxel(worldToVoxelTransform(g), p);
}

/** World-space center of the volume. */
export function volumeCenter(g: VolumeGeometry, dims: Vec3): Vec3 {
  return voxelToWorld(g, (dims[0] - 1) / 2, (dims[1] - 1) / 2, (dims[2] - 1) / 2);
}

// ─── DICOM ───────────────────────────────────────────────────────────────────

/**
 * Builds geometry from DICOM ImageOrientationPatient (row direction cosines, then column direction
 * cosines), PixelSpacing ([between rows, between columns]) and the ImagePositionPatient of every
 * slice in volume order. With a single slice the slice axis is row × column and `sliceSpacing` is used.
 */
export function geometryFromDicom(
  iop: number[],
  pixelSpacing: [number, number],
  positions: Vec3[],
  sliceSpacing: number,
  frameOfReferenceUid?: string,
): VolumeGeometry {
  const row = normalize([iop[0], iop[1], iop[2]]);
  const col = normalize([iop[3], iop[4], iop[5]]);
  const normal = normalize(cross(row, col));
  let sliceAxis = normal;
  let spacingZ = sliceSpacing > 0 ? sliceSpacing : 1;
  if (positions.length > 1) {
    const span = sub(positions[positions.length - 1], positions[0]);
    const length = norm(span);
    if (length > 1e-6) {
      sliceAxis = scale(span, 1 / length);
      spacingZ = length / (positions.length - 1);
    }
  }
  return {
    origin: positions[0] ?? [0, 0, 0],
    axes: [row, col, sliceAxis],
    spacing: [pixelSpacing[1] || 1, pixelSpacing[0] || 1, spacingZ],
    frameOfReferenceUid,
  };
}

// ─── NIfTI ───────────────────────────────────────────────────────────────────

/**
 * Geometry from a NIfTI-1 sform (3×4, RAS, row-major srow_x/y/z). NIfTI uses RAS world
 * coordinates; DICOM/LPS is obtained by negating x and y.
 */
export function geometryFromNiftiSform(srow: number[]): VolumeGeometry {
  const lps = [-srow[0], -srow[1], -srow[2], -srow[3], -srow[4], -srow[5], -srow[6], -srow[7], srow[8], srow[9], srow[10], srow[11]];
  const colVec = (c: number): Vec3 => [lps[c], lps[4 + c], lps[8 + c]];
  const cols = [colVec(0), colVec(1), colVec(2)];
  return {
    origin: [lps[3], lps[7], lps[11]],
    axes: [normalize(cols[0]), normalize(cols[1]), normalize(cols[2])],
    spacing: [norm(cols[0]) || 1, norm(cols[1]) || 1, norm(cols[2]) || 1],
  };
}

/** Geometry from a NIfTI-1 qform (quaternion b, c, d, offsets, pixdim, qfac), RAS → LPS. */
export function geometryFromNiftiQform(b: number, c: number, d: number, offset: Vec3, pixdim: Vec3, qfac: number): VolumeGeometry {
  const a = Math.sqrt(Math.max(0, 1 - (b * b + c * c + d * d)));
  const R = [
    a * a + b * b - c * c - d * d, 2 * (b * c - a * d), 2 * (b * d + a * c),
    2 * (b * c + a * d), a * a + c * c - b * b - d * d, 2 * (c * d - a * b),
    2 * (b * d - a * c), 2 * (c * d + a * b), a * a + d * d - c * c - b * b,
  ];
  const q = qfac < 0 ? -1 : 1;
  const srow = [
    R[0] * pixdim[0], R[1] * pixdim[1], R[2] * pixdim[2] * q, offset[0],
    R[3] * pixdim[0], R[4] * pixdim[1], R[5] * pixdim[2] * q, offset[1],
    R[6] * pixdim[0], R[7] * pixdim[1], R[8] * pixdim[2] * q, offset[2],
  ];
  return geometryFromNiftiSform(srow);
}

/** NIfTI sform rows (RAS, 3×4 row-major) for a geometry. */
export function niftiSformFromGeometry(g: VolumeGeometry): number[] {
  const m = indexToWorldMatrix(g);
  return [-m[0], -m[1], -m[2], -g.origin[0], -m[3], -m[4], -m[5], -g.origin[1], m[6], m[7], m[8], g.origin[2]];
}

/**
 * NIfTI qform parameters (RAS) for a geometry with orthogonal axes: quaternion b, c, d, qfac and
 * offsets. Returns null for non-orthogonal (sheared) geometries.
 */
export function niftiQformFromGeometry(g: VolumeGeometry): { b: number; c: number; d: number; qfac: number; offset: Vec3 } | null {
  // RAS direction cosines as columns.
  const toRas = (v: Vec3): Vec3 => [-v[0], -v[1], v[2]];
  const c0 = toRas(g.axes[0]);
  const c1 = toRas(g.axes[1]);
  let c2 = toRas(g.axes[2]);
  if (Math.abs(dot(c0, c1)) > 1e-4 || Math.abs(dot(c0, c2)) > 1e-4 || Math.abs(dot(c1, c2)) > 1e-4) return null;
  let qfac = 1;
  if (dot(cross(c0, c1), c2) < 0) {
    qfac = -1;
    c2 = scale(c2, -1);
  }
  const r11 = c0[0], r12 = c1[0], r13 = c2[0];
  const r21 = c0[1], r22 = c1[1], r23 = c2[1];
  const r31 = c0[2], r32 = c1[2], r33 = c2[2];
  let a = 1 + r11 + r22 + r33;
  let b: number, c: number, d: number;
  if (a > 0.5) {
    a = 0.5 * Math.sqrt(a);
    b = (0.25 * (r32 - r23)) / a;
    c = (0.25 * (r13 - r31)) / a;
    d = (0.25 * (r21 - r12)) / a;
  } else {
    const xd = 1 + r11 - (r22 + r33);
    const yd = 1 + r22 - (r11 + r33);
    const zd = 1 + r33 - (r11 + r22);
    if (xd > 1) {
      b = 0.5 * Math.sqrt(xd);
      c = (0.25 * (r12 + r21)) / b;
      d = (0.25 * (r13 + r31)) / b;
      a = (0.25 * (r32 - r23)) / b;
    } else if (yd > 1) {
      c = 0.5 * Math.sqrt(yd);
      b = (0.25 * (r12 + r21)) / c;
      d = (0.25 * (r23 + r32)) / c;
      a = (0.25 * (r13 - r31)) / c;
    } else {
      d = 0.5 * Math.sqrt(zd);
      b = (0.25 * (r13 + r31)) / d;
      c = (0.25 * (r23 + r32)) / d;
      a = (0.25 * (r21 - r12)) / d;
    }
    if (a < 0) {
      b = -b;
      c = -c;
      d = -d;
    }
  }
  return { b, c, d, qfac, offset: [-g.origin[0], -g.origin[1], g.origin[2]] };
}

// ─── Rotation ────────────────────────────────────────────────────────────────

/** Row-major rotation matrix R = Rz · Ry · Rx (angles in degrees). */
export function rotationMatrix(rxDeg: number, ryDeg: number, rzDeg: number): number[] {
  const [a, b, c] = [rxDeg, ryDeg, rzDeg].map((d) => (d * Math.PI) / 180);
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa,
    sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa,
    -sb, cb * sa, cb * ca,
  ];
}
