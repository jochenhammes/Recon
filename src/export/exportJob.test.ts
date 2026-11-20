import { describe, expect, it } from "vitest";
import { listZip } from "../core/unzip";
import { voxelToWorld, worldToVoxelTransform } from "../core/geometry";
import { IDENTITY_MAT4, IDENTITY_PARAMS, applyMat4, matrixFromParams, transformGeometry } from "../core/transform";
import { buildNiftiFile } from "./niftiWriter";
import { originShift } from "../registration/landmarks";
import { createDataset } from "../dataset/types";
import { Volume3D } from "../viewer/volume";
import { parseNifti1 } from "../viewer/volumeLoader";
import { type ExportItem, type ExportSettings, exportDatasetFiles, packageFiles } from "./exportJob";

const vol = new Volume3D(Float32Array.from({ length: 4 * 5 * 6 }, (_, i) => i), 6, 5, 4, [3, 2, 2]);
const item = (matrix = IDENTITY_MAT4, suvFactor: number | null = null): ExportItem => ({
  id: "a",
  label: "PT · test",
  dataset: createDataset(vol, { kind: "reconstruction" }, "test.nii"),
  matrix,
  w2v: worldToVoxelTransform(vol.geometry),
  suvFactor,
});
const nifti: ExportSettings = { format: "nifti", space: { kind: "native" }, suv: false, markSeries: true, adjustWindow: true };
const parse = (b: Uint8Array) => parseNifti1(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);

describe("export without resampling", () => {
  it("writes the registration into the NIfTI header, voxels unchanged", async () => {
    const M = matrixFromParams({ ...IDENTITY_PARAMS, tx: 12, ty: -7, tz: 30, rx: 10, rz: -15 }, [4, 5, 6]);
    const { files, warnings } = await exportDatasetFiles(item(M), nifti, 0);
    expect(warnings.join()).toMatch(/Registrierung im NIfTI-Header/);
    const back = parse(files[0].bytes).volume;
    expect([back.nx, back.ny, back.nz]).toEqual([4, 5, 6]);
    expect(Array.from(back.data)).toEqual(Array.from(vol.data));
    for (const [i, j, k] of [[0, 0, 0], [3, 4, 5], [1, 2, 3]]) {
      const want = applyMat4(M, voxelToWorld(vol.geometry, i, j, k));
      const got = voxelToWorld(back.geometry, i, j, k);
      got.forEach((v, a) => expect(v).toBeCloseTo(want[a], 3));
    }
  });

  it("a new origin taken into a NIfTI dataset is written instead of the original header", async () => {
    const orig = parse(buildNiftiFile(vol, {}));
    const landmark = voxelToWorld(orig.volume.geometry, 2, 3, 4);
    const T = originShift(landmark);
    const moved = new Volume3D(orig.volume.data, 6, 5, 4, [3, 2, 2], transformGeometry(orig.volume.geometry, T));
    const d = { ...createDataset(moved, { kind: "nifti" as const, fileName: "x.nii", nifti: orig.nifti }, "x.nii"), reoriented: T };
    const { files } = await exportDatasetFiles({ ...item(), dataset: d, w2v: worldToVoxelTransform(moved.geometry) }, nifti, 0);
    const back = parse(files[0].bytes).volume;
    voxelToWorld(back.geometry, 2, 3, 4).forEach((v) => expect(Math.abs(v)).toBeLessThan(1e-3));
  });

  it("converts PET values to SUV on request", async () => {
    const { files } = await exportDatasetFiles(item(IDENTITY_MAT4, 0.5), { ...nifti, suv: true }, 0);
    expect(files[0].name).toMatch(/_SUV\.nii$/);
    const bytes = files[0].bytes;
    expect(new TextDecoder().decode(bytes.subarray(148, 168))).toContain("SUVbw");
    expect(parse(bytes).volume.data[10]).toBeCloseTo(5);
    // Without SUV factor the option does nothing.
    const plain = await exportDatasetFiles(item(), { ...nifti, suv: true }, 0);
    expect(plain.files[0].name).not.toMatch(/_SUV/);
  });

  it("packages one file directly and several as ZIP with unique names and series folders", async () => {
    const f = new Uint8Array(4) as Uint8Array<ArrayBuffer>;
    expect(packageFiles([{ name: "a.nii", bytes: f }], "x.zip").name).toBe("a.nii");
    const z = packageFiles(
      [
        { name: "PT_a.nii", bytes: f },
        { name: "PT_a.nii", bytes: f },
        { name: "IM1.dcm", bytes: f, folder: "CT_b" },
        { name: "IM2.dcm", bytes: f, folder: "CT_b" },
      ],
      "Export.zip",
    );
    expect(z.type).toBe("application/zip");
    const names = listZip(z.bytes.buffer as ArrayBuffer).map((e) => e.name).sort();
    expect(names).toEqual(["CT_b/IM1.dcm", "CT_b/IM2.dcm", "PT_a.nii", "PT_a_2.nii"]);
  });
});
