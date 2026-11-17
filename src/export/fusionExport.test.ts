import dicomParser from "dicom-parser";
import { describe, expect, it } from "vitest";
import { worldToVoxelTransform } from "../core/geometry";
import { Volume3D } from "../viewer/volume";
import { axialGridCovering, buildFusionDicomSeries, buildFusionNifti, renderFusion } from "./fusionExport";

const geom = { origin: [0, 0, 0] as [number, number, number], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]], spacing: [2, 2, 2] as [number, number, number] };
const vol = (f: (i: number) => number) => new Volume3D(Float32Array.from({ length: 4 * 4 * 3 }, (_, i) => f(i)), 3, 4, 4, [2, 2, 2], geom);
const grid = { nx: 4, ny: 4, nz: 3, geometry: geom };

describe("fusion export", () => {
  it("composites visible layers with window, LUT and opacity", () => {
    const base = vol(() => 100);
    const pet = vol((i) => (i % 2 ? 10 : 0));
    const layers = [
      { volume: base, w2v: worldToVoxelTransform(geom), display: { window: [0, 100] as [number, number], lut: "gray" as const, opacity: 1, visible: true } },
      { volume: pet, w2v: worldToVoxelTransform(geom), display: { window: [0, 10] as [number, number], lut: "kidney" as const, opacity: 0.5, visible: true } },
    ];
    const rgb = renderFusion(layers, grid);
    // Voxel 0: overlay at window minimum → transparent → white base.
    expect([rgb[0], rgb[1], rgb[2]]).toEqual([255, 255, 255]);
    // Voxel 1: hot LUT max (white) blended 50 % with white → white; check a red-ish mid value instead.
    const mid = renderFusion([layers[0], { ...layers[1], display: { ...layers[1].display, window: [0, 20] } }], grid);
    expect(mid[3]).toBe(255);
    expect(mid[4]).toBeLessThan(255);
    // Hidden overlay: base only.
    const hidden = renderFusion([layers[0], { ...layers[1], display: { ...layers[1].display, visible: false } }], grid);
    expect([...hidden.subarray(0, 6)]).toEqual([255, 255, 255, 255, 255, 255]);
  });

  it("writes NIfTI RGB24 and RGB DICOM slices with patient geometry", () => {
    const rgb = Uint8Array.from({ length: 4 * 4 * 3 * 3 }, (_, i) => i % 256);
    const nii = buildFusionNifti(rgb, grid);
    const all = new DataView(nii.buffer);
    expect(all.getInt16(70, true)).toBe(128);
    expect(nii.length).toBe(352 + rgb.length);
    expect([all.getInt16(42, true), all.getInt16(44, true), all.getInt16(46, true), all.getInt16(72, true)]).toEqual([4, 4, 3, 24]);
    expect(all.getInt16(254, true)).toBeGreaterThan(0); // sform present
    const files = buildFusionDicomSeries(rgb, grid, { seriesDescription: "Fusion PT+CT", anonymize: true });
    expect(files).toHaveLength(3);
    const ds = dicomParser.parseDicom(files[2].bytes);
    expect(ds.uint16("x00280002")).toBe(3);
    expect(ds.string("x00280004")).toBe("RGB");
    expect(ds.string("x00200032")).toBe("0\\0\\4");
    expect(ds.string("x00100010")).toBe("ANONYMIZED");
    const px = ds.elements.x7fe00010;
    expect(px.length).toBe(48);
    expect(files[2].bytes[px.dataOffset]).toBe(rgb[96]);
  });

  it("builds an axial grid covering an oblique volume", () => {
    const c = Math.SQRT1_2;
    const oblique = { nx: 10, ny: 10, nz: 5, geometry: { ...geom, axes: [[c, c, 0], [-c, c, 0], [0, 0, 1]] as typeof geom.axes } };
    const g = axialGridCovering(oblique);
    expect(g.geometry.axes).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    expect(g.nx).toBeGreaterThanOrEqual(14);
    expect(g.nz).toBe(5);
  });
});
