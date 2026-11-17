import type { Volume3D } from "../viewer/volume";
import type { NiftiSourceInfo } from "../dataset/types";
import { niftiQformFromGeometry, niftiSformFromGeometry } from "../core/geometry";

const HEADER_SIZE = 348;
const EXTENSION_SIZE = 4;
const VOX_OFFSET = HEADER_SIZE + EXTENSION_SIZE;

const DT_FLOAT32 = 16;
const NIFTI_UNITS_MM = 2;

/**
 * Builds a single-file NIfTI-1 (.nii) volume from a reconstructed Volume3D.
 * Voxel data is written as float32 with no patient/identity information: only
 * dimensions, voxel spacing (mm) and the patient-space orientation (sform/qform) are stored.
 */
export function buildNiftiFile(volume: Volume3D): Uint8Array<ArrayBuffer> {
  const { nx, ny, nz, data, voxelSpacingMm } = volume;
  const [spacingZ, spacingY, spacingX] = voxelSpacingMm;

  const header = new ArrayBuffer(HEADER_SIZE);
  const dv = new DataView(header);

  dv.setInt32(0, HEADER_SIZE, true); // sizeof_hdr
  dv.setUint8(39, 0); // regular

  // dim[0..7]: number of dims, then nx, ny, nz, and unused dims set to 1.
  dv.setInt16(40, 3, true);
  dv.setInt16(42, nx, true);
  dv.setInt16(44, ny, true);
  dv.setInt16(46, nz, true);
  dv.setInt16(48, 1, true);
  dv.setInt16(50, 1, true);
  dv.setInt16(52, 1, true);
  dv.setInt16(54, 1, true);

  dv.setInt16(70, DT_FLOAT32, true); // datatype
  dv.setInt16(72, 32, true); // bitpix

  // pixdim[0..7]: qfac, then x/y/z spacing in mm.
  dv.setFloat32(76, 1, true);
  dv.setFloat32(80, spacingX, true);
  dv.setFloat32(84, spacingY, true);
  dv.setFloat32(88, spacingZ, true);

  dv.setFloat32(108, VOX_OFFSET, true); // vox_offset
  dv.setFloat32(112, 1, true); // scl_slope
  dv.setFloat32(116, 0, true); // scl_inter

  writeAscii(dv, 148, 80, "Recon Studio export (anonymized)");

  // Orientation: sform from the volume's patient geometry (LPS → RAS); qform as well if the axes
  // are orthogonal. Code 1 = scanner-based anatomical coordinates.
  const srow = niftiSformFromGeometry(volume.geometry);
  for (let i = 0; i < 12; i++) dv.setFloat32(280 + i * 4, srow[i], true);
  dv.setInt16(254, 1, true); // sform_code
  const q = niftiQformFromGeometry(volume.geometry);
  if (q) {
    dv.setInt16(252, 1, true); // qform_code
    dv.setFloat32(76, q.qfac, true); // pixdim[0] = qfac
    dv.setFloat32(256, q.b, true);
    dv.setFloat32(260, q.c, true);
    dv.setFloat32(264, q.d, true);
    dv.setFloat32(268, q.offset[0], true);
    dv.setFloat32(272, q.offset[1], true);
    dv.setFloat32(276, q.offset[2], true);
  } else {
    dv.setInt16(252, 0, true);
  }

  dv.setUint8(123, NIFTI_UNITS_MM); // xyzt_units (spatial = mm, temporal = unknown)

  writeAscii(dv, 344, 4, "n+1\0");

  const extension = new Uint8Array(EXTENSION_SIZE); // all-zero: no extensions present

  const voxelBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  const out = new Uint8Array(HEADER_SIZE + EXTENSION_SIZE + voxelBytes.length);
  out.set(new Uint8Array(header), 0);
  out.set(extension, HEADER_SIZE);
  out.set(voxelBytes, VOX_OFFSET);
  return out;
}

function writeAscii(dv: DataView, offset: number, maxLen: number, s: string) {
  for (let i = 0; i < Math.min(s.length, maxLen); i++) {
    dv.setUint8(offset + i, s.charCodeAt(i) & 0xff);
  }
}

/**
 * Writes the volume into a copy of an original NIfTI-1 header (incl. extensions, qform/sform,
 * description, intent, etc.). Only datatype/bitpix (→ float32) and scl_slope/scl_inter (→ 1/0)
 * are changed; vox_offset stays the same. Returns null for big-endian originals.
 */
export function buildNiftiFromOriginalHeader(volume: Volume3D, nifti: NiftiSourceInfo): Uint8Array<ArrayBuffer> | null {
  if (!nifti.littleEndian) return null;
  const voxOffset = nifti.headerBytes.length;
  const { data } = volume;
  const out = new Uint8Array(voxOffset + data.byteLength);
  out.set(nifti.headerBytes, 0);
  const dv = new DataView(out.buffer);
  dv.setInt16(70, DT_FLOAT32, true);
  dv.setInt16(72, 32, true);
  dv.setFloat32(112, 1, true);
  dv.setFloat32(116, 0, true);
  // Only the first 3D volume of a 4D+ file is loaded/exported: make the header 3D accordingly.
  if (dv.getInt16(40, true) > 3) {
    dv.setInt16(40, 3, true);
    for (let i = 4; i <= 7; i++) dv.setInt16(40 + i * 2, 1, true);
  }
  out.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), voxOffset);
  return out;
}
