import { describe, expect, it } from "vitest";
import { buildReconstructionDicom } from "../export/dicomWriter";
import { Volume3D } from "./volume";
import { loadVolumeFromFiles } from "./volumeLoader";

const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]];

describe("loading files without extension / from folders", () => {
  it("loads DICOM without file extension and skips hidden, index and non-DICOM files", async () => {
    const vol = new Volume3D(Float32Array.from({ length: 4 * 4 * 3 }, (_, i) => i), 3, 4, 4, [2, 2, 2], { origin: [0, 0, 0], axes, spacing: [2, 2, 2] });
    const dcm = buildReconstructionDicom(vol, { seriesDescription: "test" });
    const files = [
      new File([dcm], "IM000001"),
      new File([new Uint8Array([0, 0, 0, 1, 2, 3])], ".DS_Store"),
      new File([new TextEncoder().encode("Befund")], "notes.txt"),
      new File([new Uint8Array(200)], "DICOMDIR"),
    ];
    const r = await loadVolumeFromFiles(files);
    expect([r.volume.nx, r.volume.ny, r.volume.nz]).toEqual([4, 4, 3]);
  });

  it("still reports an error when nothing is readable", async () => {
    await expect(loadVolumeFromFiles([new File([new TextEncoder().encode("x")], "readme")])).rejects.toThrow();
  });
});

describe("multi-series upload", () => {
  it("loads every series and NIfTI separately and ignores unreadable files", async () => {
    const { loadVolumesFromFiles } = await import("./volumeLoader");
    const { buildNiftiFile } = await import("../export/niftiWriter");
    const mk = (n: number) => new Volume3D(Float32Array.from({ length: 4 * 4 * n }, (_, i) => i), n, 4, 4, [2, 2, 2], { origin: [0, 0, 0], axes, spacing: [2, 2, 2] });
    const files = [
      new File([buildReconstructionDicom(mk(3), { seriesDescription: "PET AC" })], "A1"),
      new File([buildReconstructionDicom(mk(5), { seriesDescription: "CT" })], "B1"),
      new File([buildNiftiFile(mk(2))], "extra.nii"),
      new File([new TextEncoder().encode("kein DICOM")], "report"),
      new File([new Uint8Array([1, 2, 3])], "broken.nii"),
      new File([new Uint8Array(10)], ".DS_Store"),
    ];
    const r = await loadVolumesFromFiles(files);
    expect(r.items.map((i) => i.loaded.volume.nz).sort()).toEqual([2, 3, 5]);
    expect(r.items.map((i) => i.name)).toEqual(expect.arrayContaining(["PET AC", "CT", "extra.nii"]));
    expect(r.skipped.sort()).toEqual(["broken.nii", "report"]);
  });
});
