import { describe, expect, it } from "vitest";
import { IDENTITY_PARAMS, matrixFromParams } from "../core/transform";
import { Volume3D } from "../viewer/volume";
import { type Normalization, fieldFromAffine } from "./model";
import { buildDeformationField, fieldCoverage, parseDeformationField } from "./yfield";

const geometry = { origin: [90, 126, -72] as [number, number, number], axes: [[-1, 0, 0], [0, -1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]], spacing: [2, 2, 2] as [number, number, number] };
const grid = { nx: 12, ny: 14, nz: 10, geometry };

describe("SPM y_*.nii deformation fields", () => {
  const affine = matrixFromParams({ ...IDENTITY_PARAMS, tx: 5, rz: 10, sx: 1.1 }, [0, 0, 0]);
  const n: Normalization = { subjectId: "s", templateName: "MNI", grid, affine, field: fieldFromAffine(grid, affine), kind: "affine" };

  it("round-trips export → import (geometry and LPS field)", () => {
    const bytes = buildDeformationField(n);
    const parsed = parseDeformationField(bytes.buffer);
    expect([parsed.grid.nx, parsed.grid.ny, parsed.grid.nz]).toEqual([12, 14, 10]);
    parsed.grid.geometry.origin.forEach((v, i) => expect(v).toBeCloseTo(geometry.origin[i], 4));
    parsed.grid.geometry.spacing.forEach((v) => expect(v).toBeCloseTo(2, 5));
    for (let i = 0; i < n.field.length; i++) expect(parsed.field[i]).toBeCloseTo(n.field[i], 3);
    expect(parsed.invalidFraction).toBe(0);
  });

  it("stores RAS positions as separate x/y/z planes like SPM", () => {
    const bytes = buildDeformationField(n);
    const dv = new DataView(bytes.buffer);
    expect([0, 1, 2, 3, 4, 5].map((i) => dv.getInt16(40 + 2 * i, true))).toEqual([5, 12, 14, 10, 1, 3]);
    const nvox = 12 * 14 * 10;
    const planes = new Float32Array(bytes.buffer, 352, nvox * 3);
    const v = 7 + 12 * (3 + 14 * 2);
    expect(planes[v]).toBeCloseTo(-n.field[3 * v], 4);
    expect(planes[nvox + v]).toBeCloseTo(-n.field[3 * v + 1], 4);
    expect(planes[2 * nvox + v]).toBeCloseTo(n.field[3 * v + 2], 4);
  });

  it("maps NaN to outside and rejects non-deformation images", () => {
    const bytes = buildDeformationField({ ...n, field: n.field.map((x, i) => (i < 3 ? NaN : x)) });
    const nvox = 12 * 14 * 10;
    new Float32Array(bytes.buffer, 352, 3 * nvox)[0] = NaN;
    const parsed = parseDeformationField(bytes.buffer);
    expect(parsed.invalidFraction).toBeCloseTo(1 / nvox, 8);
    const bad = new Uint8Array(bytes);
    new DataView(bad.buffer).setInt16(50, 2, true); // dim[5] = 2
    expect(() => parseDeformationField(bad.buffer)).toThrow();
  });

  it("measures how much of the field lies in the subject's field of view", () => {
    const subject = new Volume3D(new Float32Array(10 * 14 * 12), 10, 14, 12, [2, 2, 2], geometry);
    const identity = { ...n, field: fieldFromAffine(grid, matrixFromParams(IDENTITY_PARAMS, [0, 0, 0])) };
    expect(fieldCoverage(identity.field, subject)).toBe(1);
    const far = identity.field.map((x, i) => (i % 3 === 0 ? x + 500 : x));
    expect(fieldCoverage(far, subject)).toBe(0);
  });
});
