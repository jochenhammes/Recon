import * as dicomParser from "dicom-parser";
import { describe, expect, it } from "vitest";
import { voxelToWorld } from "../core/geometry";
import type { DicomSourceFile } from "../dataset/types";
import { applyEdit } from "../edit/operations";
import { asFile, buildPart10, s } from "../test/dicomFixtures";
import { loadVolumeFromFiles } from "../viewer/volumeLoader";
import { buildTemplateSeries } from "./templateDicomWriter";

const close = (a: number[], b: number[], digits = 3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

function slice(z: number, n: number, values: number[]) {
  return buildPart10({
    rows: 2,
    cols: 3,
    frames: 1,
    pixels: values,
    instanceNumber: n,
    extra: [
      { tag: [0x0020, 0x0032], vr: "DS", value: s("DS", `-10\\-20\\${z}`) },
      { tag: [0x0020, 0x0037], vr: "DS", value: s("DS", "1\\0\\0\\0\\1\\0") },
      { tag: [0x0020, 0x0052], vr: "UI", value: s("UI", "1.2.3.4.5") },
      { tag: [0x0020, 0x1041], vr: "DS", value: s("DS", String(z)) },
    ],
  });
}

async function loadSeries() {
  const files = [0, 4, 8, 12].map((z, i) => asFile(slice(z, i + 1, [1, 2, 3, 4, 5, 6].map((v) => v * 10 + i)), `s${i}.dcm`));
  return loadVolumeFromFiles(files);
}

describe("buildTemplateSeries", () => {
  it("writes a cropped volume as a new series with correct geometry and preserved header", async () => {
    const { volume, source } = await loadSeries();
    const template = (source as { files: DicomSourceFile[] }).files[0];
    const cropped = applyEdit(volume, { type: "crop", min: [1, 0, 1], max: [2, 1, 2] }).volume;
    const { files } = buildTemplateSeries(cropped, template, { seriesDescription: "cropped" });
    expect(files.map((f) => f.name)).toEqual(["IM00001.dcm", "IM00002.dcm"]);

    const ds = files.map((f) => dicomParser.parseDicom(f.bytes));
    expect(ds[0].uint16("x00280010")).toBe(2);
    expect(ds[0].uint16("x00280011")).toBe(2);
    expect(ds[1].string("x00200013")).toBe("2");
    expect(ds[0].string("x00100010")).toBe("Doe^Jane"); // header preserved
    expect(ds[0].string("x0008103e")).toBe("cropped");
    expect(ds[0].string("x0020000e")).toBe(ds[1].string("x0020000e"));
    expect(ds[0].string("x0020000e")).not.toBe("1.2.3.200");

    const reloaded = await loadVolumeFromFiles(files.map((f) => asFile(f.bytes, f.name)));
    expect([reloaded.volume.nx, reloaded.volume.ny, reloaded.volume.nz]).toEqual([2, 2, 2]);
    expect(Array.from(reloaded.volume.data)).toEqual(Array.from(cropped.data));
    close(reloaded.volume.geometry.origin, cropped.geometry.origin);
    close(reloaded.volume.geometry.spacing, cropped.geometry.spacing);
  });

  it("writes resampled multi-frame (NM) data as one file with updated frames and detector geometry", async () => {
    const bytes = buildPart10({
      rows: 2,
      cols: 2,
      frames: 4,
      pixels: Array.from({ length: 16 }, (_, i) => i * 3),
      extra: [
        { tag: [0x0018, 0x0088], vr: "DS", value: s("DS", "4") },
        { tag: [0x0020, 0x0032], vr: "DS", value: s("DS", "0\\0\\-20") },
        { tag: [0x0020, 0x0037], vr: "DS", value: s("DS", "1\\0\\0\\0\\1\\0") },
      ],
    });
    const { volume, source } = await loadVolumeFromFiles([asFile(bytes, "nm.dcm")]);
    const resampled = applyEdit(volume, { type: "resample", spacing: [4.8, 4.8, 8] }).volume;
    expect(resampled.nz).toBe(2);
    const { files } = buildTemplateSeries(resampled, (source as { files: DicomSourceFile[] }).files[0]);
    expect(files).toHaveLength(1);
    const ds = dicomParser.parseDicom(files[0].bytes);
    expect(ds.string("x00280008")).toBe("2");
    expect(ds.elements["x00540022"].items).toHaveLength(1);
    const reloaded = await loadVolumeFromFiles([asFile(files[0].bytes, "out.dcm")]);
    close(reloaded.volume.geometry.origin, resampled.geometry.origin);
    close(voxelToWorld(reloaded.volume.geometry, 0, 0, 1), voxelToWorld(resampled.geometry, 0, 0, 1));
    reloaded.volume.data.forEach((v, i) => expect(v).toBeCloseTo(resampled.data[i], 4));
  });

  it("takes the frame of reference from the options (fusion export)", async () => {
    const { volume, source } = await loadSeries();
    const { files } = buildTemplateSeries(volume, (source as { files: DicomSourceFile[] }).files[0], { frameOfReferenceUid: "9.8.7" });
    expect(dicomParser.parseDicom(files[0].bytes).string("x00200052")).toBe("9.8.7");
  });
});
