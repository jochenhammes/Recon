import { describe, expect, it } from "vitest";
import { Volume3D } from "../viewer/volume";
import { buildNiftiFile } from "./niftiWriter";

describe("buildNiftiFile", () => {
  it("writes a valid NIfTI-1 single-file header with correct dims, spacing, and voxel data", () => {
    const nz = 2;
    const ny = 3;
    const nx = 4;
    const data = new Float32Array(nz * ny * nx);
    for (let i = 0; i < data.length; i++) data[i] = i + 0.5;
    const volume = new Volume3D(data, nz, ny, nx, [5, 2, 1]);

    const bytes = buildNiftiFile(volume);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(dv.getInt32(0, true)).toBe(348); // sizeof_hdr
    expect(dv.getInt16(40, true)).toBe(3); // dim[0]
    expect(dv.getInt16(42, true)).toBe(nx);
    expect(dv.getInt16(44, true)).toBe(ny);
    expect(dv.getInt16(46, true)).toBe(nz);
    expect(dv.getInt16(70, true)).toBe(16); // datatype DT_FLOAT32
    expect(dv.getInt16(72, true)).toBe(32); // bitpix

    expect(dv.getFloat32(80, true)).toBeCloseTo(1); // pixdim x
    expect(dv.getFloat32(84, true)).toBeCloseTo(2); // pixdim y
    expect(dv.getFloat32(88, true)).toBeCloseTo(5); // pixdim z

    expect(dv.getFloat32(108, true)).toBe(352); // vox_offset
    expect(dv.getInt16(254, true)).toBe(1); // sform_code

    const magic = String.fromCharCode(bytes[344], bytes[345], bytes[346]);
    expect(magic).toBe("n+1");

    expect(bytes.length).toBe(352 + data.byteLength);
    const voxelView = new DataView(bytes.buffer, bytes.byteOffset + 352, data.byteLength);
    for (let i = 0; i < data.length; i++) {
      expect(voxelView.getFloat32(i * 4, true)).toBeCloseTo(data[i]);
    }
  });

  it("does not embed any patient-identifying text", () => {
    const volume = new Volume3D(new Float32Array(8), 2, 2, 2, [1, 1, 1]);
    const bytes = buildNiftiFile(volume);
    const text = new TextDecoder("ascii").decode(bytes.subarray(0, 352));
    expect(text).not.toMatch(/patient/i);
  });
});
