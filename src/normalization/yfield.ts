import { niftiQformFromGeometry, niftiSformFromGeometry, worldToVoxelTransform } from "../core/geometry";
import type { TargetGrid } from "../resample/resample";
import type { Volume3D } from "../viewer/volume";
import { readNiftiAll } from "../viewer/volumeLoader";
import type { Normalization } from "./model";

import { t } from "../i18n";
/**
 * SPM / CAT12 deformation fields (y_*.nii): 5D NIfTI with dim = [nx, ny, nz, 1, 3], float. For every
 * voxel of the standard-space grid (the file's own header geometry) the three planes hold the position
 * in the subject image's world coordinates (mm, NIfTI RAS). Internally fields are LPS and xyz interleaved.
 */

/** Position used for voxels without a valid mapping (NaN in the file): far outside any image. */
const OUTSIDE = 1e7;

export class DeformationFieldError extends Error {}

export interface ParsedField {
  grid: TargetGrid;
  /** LPS, xyz interleaved. */
  field: Float32Array;
  /** Fraction of voxels with NaN/invalid positions. */
  invalidFraction: number;
}

export function parseDeformationField(buffer: ArrayBuffer): ParsedField {
  const n = readNiftiAll(buffer);
  const [nx, ny, nz] = n.dims;
  const rest = n.dims.slice(3);
  const components = rest.reduce((a, b) => a * b, 1);
  // Accept [x,y,z,1,3] (SPM) and [x,y,z,3] (some tools write 4D).
  if (components !== 3 || !rest.every((d, i) => d === 1 || (d === 3 && rest.slice(i + 1).every((x) => x === 1))))
    throw new DeformationFieldError(t("Kein Verformungsfeld: erwartet {nx}×{ny}×{nz}×1×3, gefunden {v}.", { nx, ny, nz, v: n.dims.join("×") }));
  const nvox = nx * ny * nz;
  const field = new Float32Array(nvox * 3);
  let invalid = 0;
  for (let v = 0; v < nvox; v++) {
    const x = n.data[v], y = n.data[nvox + v], z = n.data[2 * nvox + v];
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) {
      invalid++;
      field[3 * v] = field[3 * v + 1] = field[3 * v + 2] = OUTSIDE;
      continue;
    }
    // RAS → LPS
    field[3 * v] = -x;
    field[3 * v + 1] = -y;
    field[3 * v + 2] = z;
  }
  return { grid: { nx, ny, nz, geometry: n.geometry }, field, invalidFraction: invalid / nvox };
}

/**
 * Fraction of valid field positions that fall inside the subject's field of view. A deformation that
 * belongs to the subject points into it almost everywhere in the brain; a low value means a wrong
 * subject or an inverse field (iy_*.nii) instead of y_*.nii.
 */
export function fieldCoverage(field: Float32Array, subject: Volume3D): number {
  const t = worldToVoxelTransform(subject.geometry);
  const { m, origin } = t;
  let inside = 0, valid = 0;
  for (let i = 0; i < field.length; i += 3) {
    const px = field[i] - origin[0], py = field[i + 1] - origin[1], pz = field[i + 2] - origin[2];
    if (Math.abs(field[i]) >= OUTSIDE) continue;
    valid++;
    const vx = m[0] * px + m[1] * py + m[2] * pz;
    const vy = m[3] * px + m[4] * py + m[5] * pz;
    const vz = m[6] * px + m[7] * py + m[8] * pz;
    if (vx >= -0.5 && vy >= -0.5 && vz >= -0.5 && vx <= subject.nx - 0.5 && vy <= subject.ny - 0.5 && vz <= subject.nz - 0.5) inside++;
  }
  return valid ? inside / valid : 0;
}

/** SPM-compatible y_*.nii of a normalization (5D float32, RAS, template grid as header geometry). */
export function buildDeformationField(n: Normalization): Uint8Array<ArrayBuffer> {
  const { nx, ny, nz, geometry } = n.grid;
  const nvox = nx * ny * nz;
  const HEADER = 348, OFFSET = 352;
  const out = new Uint8Array(new ArrayBuffer(OFFSET + nvox * 3 * 4));
  const dv = new DataView(out.buffer);
  dv.setInt32(0, HEADER, true);
  [5, nx, ny, nz, 1, 3, 1, 1].forEach((d, i) => dv.setInt16(40 + 2 * i, d, true));
  dv.setInt16(68, 1007, true); // intent_code NIFTI_INTENT_VECTOR
  dv.setInt16(70, 16, true); // float32
  dv.setInt16(72, 32, true);
  const sp = geometry.spacing;
  [1, sp[0], sp[1], sp[2], 1, 1, 1, 1].forEach((p, i) => dv.setFloat32(76 + 4 * i, p, true));
  dv.setFloat32(108, OFFSET, true);
  dv.setFloat32(112, 1, true);
  dv.setFloat32(116, 0, true);
  dv.setUint8(123, 2 | 8); // xyzt_units: mm, s
  writeAscii(dv, 148, 80, t("Deformation (Recon Studio, {kind}) -> {templateName}", { kind: n.kind, templateName: n.templateName }));
  const srow = niftiSformFromGeometry(geometry);
  for (let i = 0; i < 12; i++) dv.setFloat32(280 + 4 * i, srow[i], true);
  dv.setInt16(254, 2, true); // sform_code: aligned
  const q = niftiQformFromGeometry(geometry);
  if (q) {
    dv.setInt16(252, 2, true);
    dv.setFloat32(76, q.qfac, true);
    dv.setFloat32(256, q.b, true);
    dv.setFloat32(260, q.c, true);
    dv.setFloat32(264, q.d, true);
    q.offset.forEach((v, i) => dv.setFloat32(268 + 4 * i, v, true));
  }
  writeAscii(dv, 328, 16, "Deformation");
  writeAscii(dv, 344, 4, "n+1");
  const data = new Float32Array(out.buffer, OFFSET, nvox * 3);
  for (let v = 0; v < nvox; v++) {
    const x = n.field[3 * v], y = n.field[3 * v + 1], z = n.field[3 * v + 2];
    const bad = Math.abs(x) >= OUTSIDE;
    data[v] = bad ? NaN : -x;
    data[nvox + v] = bad ? NaN : -y;
    data[2 * nvox + v] = bad ? NaN : z;
  }
  return out;
}

function writeAscii(dv: DataView, offset: number, max: number, s: string) {
  for (let i = 0; i < Math.min(max - 1, s.length); i++) dv.setUint8(offset + i, s.charCodeAt(i) & 0x7f);
}
