import { describe, expect, it } from "vitest";
import { buildNiftiFile } from "../export/niftiWriter";
import { asFile, buildPart10, s } from "../test/dicomFixtures";
import { Volume3D } from "../viewer/volume";
import { loadVolumeFromFiles, parseNifti1 } from "../viewer/volumeLoader";
import {
  type Vec3,
  type VolumeGeometry,
  geometryFromDicom,
  geometryFromNiftiQform,
  geometryFromNiftiSform,
  niftiQformFromGeometry,
  niftiSformFromGeometry,
  normalize,
  voxelToWorld,
  worldToVoxel,
} from "./geometry";

const close = (a: number[], b: number[], digits = 4) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

const oblique: VolumeGeometry = {
  origin: [-120.5, 33, 250],
  axes: [normalize([1, 0.2, 0]), normalize([-0.2, 1, 0]), [0, 0, 1]],
  spacing: [2, 2.5, 4],
};

describe("geometry", () => {
  it("round-trips voxel ↔ world for oblique geometry", () => {
    const p = voxelToWorld(oblique, 10.5, -3, 7);
    close(worldToVoxel(oblique, p), [10.5, -3, 7], 9);
  });

  it("derives slice axis and spacing from slice positions", () => {
    const g = geometryFromDicom([1, 0, 0, 0, 1, 0], [3, 2], [[0, 0, -10], [0, 0, -6], [0, 0, -2]], 99);
    expect(g.spacing).toEqual([2, 3, 4]);
    close(g.axes[2], [0, 0, 1]);
    close(voxelToWorld(g, 1, 1, 2), [2, 3, -2]);
  });

  it("round-trips NIfTI sform and qform (RAS) with LPS geometry", () => {
    const fromS = geometryFromNiftiSform(niftiSformFromGeometry(oblique));
    close(fromS.origin, oblique.origin);
    close(fromS.spacing, oblique.spacing);
    fromS.axes.forEach((a, i) => close(a, oblique.axes[i]));

    const flipped: VolumeGeometry = { ...oblique, axes: [oblique.axes[0], oblique.axes[1], [0, 0, -1]] };
    const q = niftiQformFromGeometry(flipped)!;
    expect(q.qfac).toBe(-1);
    const fromQ = geometryFromNiftiQform(q.b, q.c, q.d, q.offset, flipped.spacing, q.qfac);
    close(fromQ.origin, flipped.origin);
    fromQ.axes.forEach((a, i) => close(a, flipped.axes[i]));
  });

  it("keeps geometry through NIfTI export and re-import", () => {
    const vol = new Volume3D(new Float32Array(2 * 3 * 4), 2, 3, 4, [4, 2.5, 2], oblique);
    const { volume } = parseNifti1(buildNiftiFile(vol).buffer);
    close(volume.geometry.origin, oblique.origin);
    volume.geometry.axes.forEach((a, i) => close(a, oblique.axes[i]));
    close(volume.geometry.spacing, oblique.spacing);
  });
});

function sliceFile(z: number, instance: number, value: number) {
  return buildPart10({
    rows: 2,
    cols: 2,
    frames: 1,
    pixels: [value, value, value, value],
    instanceNumber: instance,
    extra: [
      { tag: [0x0020, 0x0032], vr: "DS", value: s("DS", `-100\\-50\\${z}`) },
      { tag: [0x0020, 0x0037], vr: "DS", value: s("DS", "1\\0\\0\\0\\1\\0") },
      { tag: [0x0020, 0x0052], vr: "UI", value: s("UI", "1.2.3.777") },
    ],
  });
}

describe("loader geometry", () => {
  it("sorts a series by position along the slice normal, not by InstanceNumber", async () => {
    // Instance numbers run opposite to the positions (as in many head-first acquisitions).
    const files = [sliceFile(10, 1, 3), sliceFile(0, 3, 1), sliceFile(5, 2, 2)].map((b, i) => asFile(b, `f${i}.dcm`));
    const { volume, source } = await loadVolumeFromFiles(files);
    expect(Array.from(volume.data).filter((_, i) => i % 4 === 0)).toEqual([1, 2, 3]);
    const g = volume.geometry;
    expect(g.origin).toEqual([-100, -50, 0]);
    close(g.axes[2], [0, 0, 1]);
    expect(g.spacing).toEqual([4.8, 4.8, 5]);
    expect(g.frameOfReferenceUid).toBe("1.2.3.777");
    // File→slice mapping follows the new order (needed by the header-preserving export).
    expect((source as { files: { fileName: string; zStart: number }[] }).files.map((f) => [f.fileName, f.zStart])).toEqual([
      ["f1.dcm", 0],
      ["f2.dcm", 1],
      ["f0.dcm", 2],
    ]);
  });

  it("steps multi-frame positions along row × column by the slice spacing", async () => {
    const bytes = buildPart10({
      rows: 2,
      cols: 2,
      frames: 3,
      pixels: new Array(12).fill(1),
      extra: [
        { tag: [0x0018, 0x0088], vr: "DS", value: s("DS", "4") },
        { tag: [0x0020, 0x0032], vr: "DS", value: s("DS", "0\\0\\-20") },
        { tag: [0x0020, 0x0037], vr: "DS", value: s("DS", "1\\0\\0\\0\\1\\0") },
      ],
    });
    const { volume } = await loadVolumeFromFiles([asFile(bytes, "nm.dcm")]);
    const last: Vec3 = voxelToWorld(volume.geometry, 0, 0, 2);
    close(last, [0, 0, -12]);
    expect(volume.hasPatientGeometry).toBe(true);
  });
});
