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
