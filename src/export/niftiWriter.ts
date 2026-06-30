import type { Volume3D } from "../viewer/volume";

const HEADER_SIZE = 348;
const EXTENSION_SIZE = 4;
const VOX_OFFSET = HEADER_SIZE + EXTENSION_SIZE;

const DT_FLOAT32 = 16;
const NIFTI_UNITS_MM = 2;

/**
 * Builds a single-file NIfTI-1 (.nii) volume from a reconstructed Volume3D.
 * Voxel data is written as float32 with no patient/identity information: only
 * dimensions, voxel spacing (mm) and a simple diagonal scanner-anat affine are stored.
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

  writeAscii(dv, 148, 80, "Recon SPECT reconstruction (anonymized)");

  dv.setInt16(252, 0, true); // qform_code (no quaternion orientation tracked)
  dv.setInt16(254, 1, true); // sform_code (scanner-anat)

  // Diagonal affine: no patient-coordinate orientation/origin is tracked by this app.
  dv.setFloat32(280, spacingX, true);
  dv.setFloat32(284, 0, true);
  dv.setFloat32(288, 0, true);
  dv.setFloat32(292, 0, true);

  dv.setFloat32(296, 0, true);
  dv.setFloat32(300, spacingY, true);
  dv.setFloat32(304, 0, true);
  dv.setFloat32(308, 0, true);

  dv.setFloat32(312, 0, true);
  dv.setFloat32(316, 0, true);
  dv.setFloat32(320, spacingZ, true);
  dv.setFloat32(324, 0, true);

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
