import { describe, expect, it } from "vitest";
import { parseNifti1, readNiftiAll } from "./volumeLoader";

/** NIfTI-1 (single file, sform set) with the given byte order and datatype; dims 3×2×2 (×nt). */
function nifti(littleEndian: boolean, datatype: 4 | 16 | 64, values: number[], nt = 1, slope = 0): ArrayBuffer {
  const size = datatype === 4 ? 2 : datatype === 16 ? 4 : 8;
  const buf = new ArrayBuffer(352 + values.length * size);
  const v = new DataView(buf);
  v.setInt32(0, 348, littleEndian);
  v.setInt16(40, nt > 1 ? 4 : 3, littleEndian);
  [3, 2, 2, nt].forEach((d, i) => v.setInt16(42 + 2 * i, d, littleEndian));
  v.setInt16(70, datatype, littleEndian);
  v.setInt16(72, size * 8, littleEndian);
  [1, 2, 3, 4].forEach((p, i) => v.setFloat32(80 + 4 * i, p === 4 ? 60 : p, littleEndian));
  v.setFloat32(108, 352, littleEndian);
  v.setFloat32(112, slope, littleEndian);
  v.setInt16(254, 1, littleEndian); // sform_code
  [[1, 0, 0, -10], [0, 2, 0, -20], [0, 0, 3, -30]].forEach((row, r) => row.forEach((x, c) => v.setFloat32(280 + 16 * r + 4 * c, x, littleEndian)));
  values.forEach((x, i) => {
    const o = 352 + i * size;
    if (datatype === 4) v.setInt16(o, x, littleEndian);
    else if (datatype === 16) v.setFloat32(o, x, littleEndian);
    else v.setFloat64(o, x, littleEndian);
  });
  return buf;
}

describe("big-endian NIfTI (e.g. GAAIN Centiloid reference data)", () => {
  const values = Array.from({ length: 12 }, (_, i) => i * 1.5 - 4);
  for (const dt of [16, 64] as const)
    it(`reads datatype ${dt} identically to little endian`, () => {
      const le = parseNifti1(nifti(true, dt, values)).volume;
      const be = parseNifti1(nifti(false, dt, values));
      expect(be.nifti.littleEndian).toBe(false);
      expect(Array.from(be.volume.data)).toEqual(Array.from(le.data));
      expect(be.volume.geometry).toEqual(le.geometry);
    });

  it("applies scl_slope to big-endian int16", () => {
    const ints = values.map((x) => Math.round(x * 2));
    const be = parseNifti1(nifti(false, 4, ints, 1, 0.5)).volume;
    expect(Array.from(be.data)).toEqual(ints.map((x) => x * 0.5));
  });

  it("reads all values of a big-endian 4D file", () => {
    const all = Array.from({ length: 24 }, (_, i) => i);
    const r = readNiftiAll(nifti(false, 16, all, 2));
    expect(r.dims).toEqual([3, 2, 2, 2]);
    expect(Array.from(r.data)).toEqual(all);
  });
});
