import { describe, expect, it } from "vitest";
import { loadVolumesFromFiles, parseBidsTiming } from "./volumeLoader";

/** Minimal Part-10 DICOM (explicit VR little endian) with one 2×2 slice. */
function dicomSlice(opts: { z: number; value: number; acqTime: string; durationMs: number; instance: number }): Uint8Array<ArrayBuffer> {
  const parts: number[] = [];
  const u16 = (v: number) => parts.push(v & 255, (v >> 8) & 255);
  const u32 = (v: number) => parts.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  const el = (g: number, e: number, vr: string, bytes: number[]) => {
    if (bytes.length % 2) bytes.push(vr === "UI" ? 0 : 32);
    u16(g);
    u16(e);
    parts.push(vr.charCodeAt(0), vr.charCodeAt(1));
    if (vr === "OW" || vr === "OB" || vr === "SQ") {
      u16(0);
      u32(bytes.length);
    } else u16(bytes.length);
    parts.push(...bytes);
  };
  const s = (t: string) => Array.from(t, (c) => c.charCodeAt(0));
  const us = (v: number) => [v & 255, (v >> 8) & 255];
  for (let i = 0; i < 128; i++) parts.push(0);
  parts.push(...s("DICM"));
  const meta: number[] = [];
  const save = parts.splice(0);
  el(0x0002, 0x0010, "UI", s("1.2.840.10008.1.2.1"));
  meta.push(...parts.splice(0));
  parts.push(...save);
  el(0x0002, 0x0000, "UL", [meta.length & 255, (meta.length >> 8) & 255, 0, 0]);
  parts.push(...meta);
  el(0x0008, 0x0020, "DA", s("20260101"));
  el(0x0008, 0x0022, "DA", s("20260101"));
  el(0x0008, 0x0032, "TM", s(opts.acqTime));
  el(0x0008, 0x0060, "CS", s("PT"));
  el(0x0018, 0x1242, "IS", s(String(opts.durationMs)));
  el(0x0020, 0x000e, "UI", s("1.2.3.4"));
  el(0x0020, 0x0013, "IS", s(String(opts.instance)));
  el(0x0020, 0x0032, "DS", s(`0\\0\\${opts.z}`));
  el(0x0020, 0x0037, "DS", s("1\\0\\0\\0\\1\\0"));
  el(0x0028, 0x0002, "US", us(1));
  el(0x0028, 0x0010, "US", us(2));
  el(0x0028, 0x0011, "US", us(2));
  el(0x0028, 0x0030, "DS", s("2\\2"));
  el(0x0028, 0x0100, "US", us(16));
  el(0x0028, 0x0101, "US", us(16));
  el(0x0028, 0x0103, "US", us(0));
  el(0x7fe0, 0x0010, "OW", [...us(opts.value), ...us(opts.value), ...us(opts.value), ...us(opts.value)]);
  return Uint8Array.from(parts);
}

describe("dynamic data", () => {
  it("splits a dynamic DICOM series into frames with timing", async () => {
    // 3 frames (60 s, 60 s, 120 s) × 3 slices, files shuffled; value = 10·frame + slice.
    const times = ["100000", "100100", "100200"], dur = [60000, 60000, 120000];
    const files: File[] = [];
    let inst = 1;
    for (let f = 0; f < 3; f++) for (let z = 0; z < 3; z++) files.push(new File([dicomSlice({ z: z * 3, value: 10 * (f + 1) + z, acqTime: times[f], durationMs: dur[f], instance: inst++ })], `IM${inst}`));
    files.reverse();
    const { items } = await loadVolumesFromFiles(files);
    expect(items).toHaveLength(1);
    const d = items[0].loaded.dynamic!;
    expect(d.frames).toHaveLength(3);
    expect(d.start).toEqual([0, 60, 120]);
    expect(d.duration).toEqual([60, 60, 120]);
    expect(items[0].loaded.volume.nz).toBe(3);
    expect(d.frames[1][4]).toBe(21); // frame 2, slice 1
    // Mean weighted by duration: (11·60 + 21·60 + 31·120)/240 for slice 1
    expect(items[0].loaded.volume.data[4]).toBeCloseTo((11 * 60 + 21 * 60 + 31 * 120) / 240, 4);
  });

  it("reads all frames of a 4D NIfTI with BIDS timing", async () => {
    const { buildNiftiFile } = await import("../export/niftiWriter");
    const { Volume3D } = await import("./volume");
    const vol = new Volume3D(new Float32Array(8), 2, 2, 2, [1, 1, 1]);
    const bytes = buildNiftiFile(vol);
    // Make it 4D with 3 frames: dim[0]=4, dim[4]=3, append data.
    const out = new Uint8Array(bytes.length + 2 * 8 * 4);
    out.set(bytes);
    const dv = new DataView(out.buffer);
    dv.setInt16(40, 4, true);
    dv.setInt16(48, 3, true);
    const voxOffset = dv.getFloat32(108, true);
    for (let t = 0; t < 3; t++) for (let i = 0; i < 8; i++) dv.setFloat32(voxOffset + (t * 8 + i) * 4, t + 1, true);
    const json = JSON.stringify({ FrameTimesStart: [0, 30, 90], FrameDuration: [30, 60, 120] });
    const { items } = await loadVolumesFromFiles([new File([out], "sub-01_pet.nii"), new File([json], "sub-01_pet.json")]);
    const d = items[0].loaded.dynamic!;
    expect(d.timeSource).toBe("bids");
    expect(d.frames.map((f) => f[0])).toEqual([1, 2, 3]);
    expect(d.duration).toEqual([30, 60, 120]);
    expect(parseBidsTiming("{}", 3)).toBeNull();
  });
});
