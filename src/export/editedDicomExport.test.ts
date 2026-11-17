import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as dicomParser from "dicom-parser";
import { describe, expect, it } from "vitest";
import { applyEdit } from "../edit/operations";
import { loadVolumeFromFiles, parseNifti1 } from "../viewer/volumeLoader";
import { concatBytes } from "./bytes";
import { IMPLICIT_VR_LE, formatDS, stringValue, u16le, u32le } from "./dicomRewriter";
import { type DicomSource, buildEditedDicomFiles } from "./editedDicomExport";
import { buildNiftiFromOriginalHeader } from "./niftiWriter";
import { buildZip } from "./zip";

const LONG_VR = new Set(["OB", "OW", "SQ", "UN", "UT"]);

interface El {
  tag: [number, number];
  vr: string;
  value: Uint8Array;
  undefinedLength?: boolean;
}

function enc(el: El, explicit: boolean): Uint8Array {
  const head = [u16le(el.tag[0]), u16le(el.tag[1])];
  const len = el.undefinedLength ? 0xffffffff : el.value.length;
  const tail = el.undefinedLength ? [u16le(0xfffe), u16le(0xe0dd), u32le(0)] : [];
  if (!explicit) return concatBytes([...head, u32le(len), el.value, ...tail]);
  const vr = Uint8Array.of(el.vr.charCodeAt(0), el.vr.charCodeAt(1));
  if (LONG_VR.has(el.vr)) return concatBytes([...head, vr, u16le(0), u32le(len), el.value, ...tail]);
  return concatBytes([...head, vr, u16le(len), el.value]);
}

const s = (vr: string, v: string) => stringValue(vr, v).value;

function item(content: Uint8Array): Uint8Array {
  return concatBytes([u16le(0xfffe), u16le(0xe000), u32le(content.length), content]);
}

interface FileSpec {
  rows: number;
  cols: number;
  frames: number;
  pixels: number[];
  transferSyntax?: string;
  slope?: number;
  intercept?: number;
  instanceNumber?: number;
  pixelRepresentation?: number;
  bitsAllocated?: number;
}

/** Builds a Part10 DICOM with meta header, a private tag, an undefined-length sequence and a defined-length sequence. */
function buildPart10(spec: FileSpec): Uint8Array<ArrayBuffer> {
  const ts = spec.transferSyntax ?? "1.2.840.10008.1.2.1";
  const explicit = ts !== IMPLICIT_VR_LE;
  const bits = spec.bitsAllocated ?? 16;
  const pixelBytes = new Uint8Array(spec.pixels.length * (bits / 8));
  const dv = new DataView(pixelBytes.buffer);
  spec.pixels.forEach((p, i) => {
    if (bits === 8) dv.setUint8(i, p);
    else if (spec.pixelRepresentation === 1) dv.setInt16(i * 2, p, true);
    else dv.setUint16(i * 2, p, true);
  });
  const seqItem = item(enc({ tag: [0x0054, 0x0200], vr: "DS", value: s("DS", "90") }, explicit));

  const meta = concatBytes(
    [
      { tag: [0x0002, 0x0001], vr: "OB", value: Uint8Array.of(0, 1) },
      { tag: [0x0002, 0x0002], vr: "UI", value: s("UI", "1.2.840.10008.5.1.4.1.1.20") },
      { tag: [0x0002, 0x0003], vr: "UI", value: s("UI", "1.2.3.4.5.6") },
      { tag: [0x0002, 0x0010], vr: "UI", value: s("UI", ts) },
    ].map((e) => enc(e as El, true)),
  );
  const elements: El[] = [
    { tag: [0x0008, 0x0008], vr: "CS", value: s("CS", "ORIGINAL\\PRIMARY\\RECON TOMO") },
    { tag: [0x0008, 0x0018], vr: "UI", value: s("UI", "1.2.3.4.5.6") },
    { tag: [0x0008, 0x0060], vr: "CS", value: s("CS", "NM") },
    { tag: [0x0008, 0x103e], vr: "LO", value: s("LO", "SPECT AC") },
    { tag: [0x0010, 0x0010], vr: "PN", value: s("PN", "Doe^Jane") },
    { tag: [0x0020, 0x000d], vr: "UI", value: s("UI", "1.2.3.100") },
    { tag: [0x0020, 0x000e], vr: "UI", value: s("UI", "1.2.3.200") },
    { tag: [0x0020, 0x0013], vr: "IS", value: s("IS", String(spec.instanceNumber ?? 1)) },
    { tag: [0x0028, 0x0002], vr: "US", value: u16le(1) },
    { tag: [0x0028, 0x0008], vr: "IS", value: s("IS", String(spec.frames)) },
    { tag: [0x0028, 0x0010], vr: "US", value: u16le(spec.rows) },
    { tag: [0x0028, 0x0011], vr: "US", value: u16le(spec.cols) },
    { tag: [0x0028, 0x0030], vr: "DS", value: s("DS", "4.8\\4.8") },
    { tag: [0x0028, 0x0100], vr: "US", value: u16le(bits) },
    { tag: [0x0028, 0x0101], vr: "US", value: u16le(bits) },
    { tag: [0x0028, 0x0102], vr: "US", value: u16le(bits - 1) },
    { tag: [0x0028, 0x0103], vr: "US", value: u16le(spec.pixelRepresentation ?? 0) },
    { tag: [0x0028, 0x0107], vr: "US", value: u16le(Math.max(...spec.pixels)) },
    ...(spec.slope !== undefined
      ? [
          { tag: [0x0028, 0x1052], vr: "DS", value: s("DS", formatDS(spec.intercept ?? 0)) } as El,
          { tag: [0x0028, 0x1053], vr: "DS", value: s("DS", formatDS(spec.slope)) } as El,
        ]
      : []),
    { tag: [0x0029, 0x0010], vr: "LO", value: s("LO", "VENDOR PRIVATE") },
    { tag: [0x0029, 0x1010], vr: "OB", value: Uint8Array.of(1, 2, 3, 4, 5, 6) },
    { tag: [0x0054, 0x0022], vr: "SQ", value: seqItem, undefinedLength: true },
    { tag: [0x0054, 0x0052], vr: "SQ", value: seqItem },
    { tag: [0x7fe0, 0x0010], vr: bits === 8 ? "OB" : "OW", value: pixelBytes },
  ];
  const groupLength = enc({ tag: [0x0002, 0x0000], vr: "UL", value: u32le(meta.length) }, true);
  const preamble = new Uint8Array(128);
  const magic = Uint8Array.of(0x44, 0x49, 0x43, 0x4d);
  return concatBytes([preamble, magic, groupLength, meta, ...elements.map((e) => enc(e, explicit))]);
}

function asFile(bytes: Uint8Array, name: string): File {
  return new File([bytes as Uint8Array<ArrayBuffer>], name);
}

/** Raw bytes of a top-level element (header + value) located via dicom-parser. */
function rawElement(bytes: Uint8Array, tag: string): Uint8Array {
  const ds = dicomParser.parseDicom(bytes);
  const el = ds.elements[tag];
  const all = Object.values(ds.elements).sort((a, b) => a.dataOffset - b.dataOffset);
  const idx = all.indexOf(el);
  const header = el.vr && LONG_VR.has(el.vr) ? 12 : 8;
  const end = idx + 1 < all.length ? all[idx + 1].dataOffset - (all[idx + 1].vr && LONG_VR.has(all[idx + 1].vr!) ? 12 : 8) : bytes.length;
  return bytes.slice(el.dataOffset - header, end);
}

async function exportRoundTrip(files: File[], threshold: number, value: number) {
  const loaded = await loadVolumeFromFiles(files);
  const edited = applyEdit(loaded.volume, { type: "thresholdReplace", threshold, value }).volume;
  const result = buildEditedDicomFiles(edited, loaded.source as DicomSource, {
    seriesDescriptionSuffix: " [bearbeitet]",
    derivationDescription: "test edit",
  });
  const reloaded = await loadVolumeFromFiles(result.files.map((f) => asFile(f.bytes, f.name)));
  return { loaded, edited, result, reloaded };
}

describe("buildEditedDicomFiles (header-preserving export)", () => {
  const pixels = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110];
  const original = buildPart10({ rows: 2, cols: 3, frames: 2, pixels });

  it("keeps the original encoding and copies all unrelated elements byte-for-byte", async () => {
    const { result, reloaded } = await exportRoundTrip([asFile(original, "a.dcm")], 60, 5);
    expect(result.warnings).toEqual([]);
    const out = result.files[0].bytes;

    expect(Array.from(reloaded.volume.data)).toEqual([0, 10, 20, 30, 40, 50, 5, 5, 5, 5, 5, 5]);
    for (const tag of ["x00080060", "x00100010", "x0020000d", "x00280030", "x00290010", "x00291010", "x00540022", "x00540052", "x00020002"]) {
      expect(rawElement(out, tag), tag).toEqual(rawElement(original, tag));
    }
    expect(out.slice(0, 132)).toEqual(original.slice(0, 132));

    const ds = dicomParser.parseDicom(out);
    expect(ds.string("x00100010")).toBe("Doe^Jane");
    expect(ds.string("x0020000d")).toBe("1.2.3.100");
    expect(ds.string("x0020000e")).not.toBe("1.2.3.200");
    expect(ds.string("x00080018")).not.toBe("1.2.3.4.5.6");
    expect(ds.string("x00020003")).toBe(ds.string("x00080018"));
    expect(ds.string("x00080008")).toBe("DERIVED\\PRIMARY\\RECON TOMO");
    expect(ds.string("x0008103e")).toBe("SPECT AC [bearbeitet]");
    expect(ds.string("x00082111")).toBe("test edit");
    expect(ds.elements["x00280107"]).toBeUndefined(); // stale LargestImagePixelValue removed
    expect(ds.elements["x00281053"]).toBeUndefined(); // no rescale tags added
    expect(ds.uint32("x00020000")).toBe(ds.elements["x00020010"].dataOffset + ds.elements["x00020010"].length - 144);
    expect(ds.elements["x00540022"].items).toHaveLength(1);
  });

  it("leaves unchanged voxels bit-exact with a fractional rescale slope", async () => {
    const withSlope = buildPart10({ rows: 2, cols: 3, frames: 2, pixels, slope: 0.37, intercept: -3 });
    const { loaded, result, reloaded } = await exportRoundTrip([asFile(withSlope, "a.dcm")], 30, -3 + 0.37 * 7);
    expect(result.warnings).toEqual([]);
    const ds = dicomParser.parseDicom(result.files[0].bytes);
    const stored = new Uint16Array(ds.byteArray.buffer.slice(ds.elements.x7fe00010.dataOffset, ds.elements.x7fe00010.dataOffset + 24));
    expect(Array.from(stored)).toEqual(pixels.map((v) => (Math.fround(v * 0.37 - 3) >= 30 ? 7 : v)));
    expect(Array.from(stored).filter((v) => v === 7)).toHaveLength(3);
    for (let i = 0; i < 9; i++) expect(reloaded.volume.data[i]).toBe(loaded.volume.data[i]);
  });

  it("rescales and warns when the new value cannot be stored with the original encoding", async () => {
    const { result, reloaded } = await exportRoundTrip([asFile(original, "a.dcm")], 100, -7.5);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Skalierung angepasst");
    const ds = dicomParser.parseDicom(result.files[0].bytes);
    expect(ds.elements["x00281053"]).toBeDefined();
    expect(ds.elements["x00281052"]).toBeDefined();
    const expected = pixels.map((p) => (p >= 100 ? -7.5 : p));
    const step = parseFloat(ds.string("x00281053")!);
    reloaded.volume.data.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThanOrEqual(step / 2 + 1e-6));
  });

  it("widens to an intercept shift for integer data instead of a fractional slope", async () => {
    const { result, reloaded } = await exportRoundTrip([asFile(original, "a.dcm")], 100, -5);
    const ds = dicomParser.parseDicom(result.files[0].bytes);
    expect(ds.string("x00281053")).toBe("1");
    expect(ds.string("x00281052")).toBe("-5");
    expect(Array.from(reloaded.volume.data)).toEqual(pixels.map((p) => (p >= 100 ? -5 : p)));
  });

  it("widens 8-bit data to 16 bit when needed", async () => {
    const eightBit = buildPart10({ rows: 2, cols: 3, frames: 2, pixels, bitsAllocated: 8 });
    const { result, reloaded } = await exportRoundTrip([asFile(eightBit, "a.dcm")], 100, 1000);
    const ds = dicomParser.parseDicom(result.files[0].bytes);
    expect(ds.uint16("x00280100")).toBe(16);
    expect(ds.uint16("x00280102")).toBe(15);
    expect(Array.from(reloaded.volume.data)).toEqual(pixels.map((p) => (p >= 100 ? 1000 : p)));
  });

  it("supports Implicit VR Little Endian originals", async () => {
    const implicit = buildPart10({ rows: 2, cols: 3, frames: 2, pixels, transferSyntax: IMPLICIT_VR_LE });
    const { result, reloaded } = await exportRoundTrip([asFile(implicit, "a.dcm")], 60, 1);
    const ds = dicomParser.parseDicom(result.files[0].bytes);
    expect(ds.string("x00020010")).toBe(IMPLICIT_VR_LE);
    expect(ds.string("x00100010")).toBe("Doe^Jane");
    expect(Array.from(reloaded.volume.data)).toEqual(pixels.map((p) => (p >= 60 ? 1 : p)));
  });

  it("exports a series with one shared new Series UID and original file names", async () => {
    const files = [3, 1, 2].map((n) =>
      asFile(buildPart10({ rows: 2, cols: 2, frames: 1, pixels: [n, n, n, n * 10], instanceNumber: n }), `IMG${n}.dcm`),
    );
    const { result, reloaded } = await exportRoundTrip(files, 20, 0);
    expect(result.files.map((f) => f.name)).toEqual(["IMG1.dcm", "IMG2.dcm", "IMG3.dcm"]);
    const uids = result.files.map((f) => dicomParser.parseDicom(f.bytes).string("x0020000e"));
    expect(new Set(uids).size).toBe(1);
    expect(uids[0]).not.toBe("1.2.3.200");
    const sops = result.files.map((f) => dicomParser.parseDicom(f.bytes).string("x00080018"));
    expect(new Set(sops).size).toBe(3);
    expect(Array.from(reloaded.volume.data)).toEqual([1, 1, 1, 10, 2, 2, 2, 0, 3, 3, 3, 0]);

    const zip = buildZip(result.files);
    const dv = new DataView(zip.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(dv.getUint16(zip.length - 12, true)).toBe(3);
  });

  it("re-writes JPEG Lossless originals uncompressed with identical values", async () => {
    const fixture = readFileSync(fileURLToPath(new URL("../dicom/fixtures/jpeg-lossless-sel1.dcm", import.meta.url)));
    const files = [asFile(new Uint8Array(fixture), "jpeg.dcm")];
    const loaded = await loadVolumeFromFiles(files);
    const result = buildEditedDicomFiles(loaded.volume, loaded.source as DicomSource);
    const ds = dicomParser.parseDicom(result.files[0].bytes);
    expect(ds.string("x00020010")).toBe("1.2.840.10008.1.2.1");
    expect(ds.elements.x7fe00010.encapsulatedPixelData).toBeFalsy();
    const reloaded = await loadVolumeFromFiles([asFile(result.files[0].bytes, "out.dcm")]);
    expect(Array.from(reloaded.volume.data)).toEqual(Array.from(loaded.volume.data));
  });
});

describe("buildNiftiFromOriginalHeader", () => {
  it("keeps header fields and extensions, switching to float32", () => {
    const voxOffset = 368;
    const buf = new ArrayBuffer(voxOffset + 8 * 2);
    const dv = new DataView(buf);
    dv.setInt32(0, 348, true);
    dv.setInt16(40, 3, true);
    dv.setInt16(42, 2, true);
    dv.setInt16(44, 2, true);
    dv.setInt16(46, 2, true);
    dv.setInt16(70, 4, true); // int16
    dv.setInt16(72, 16, true);
    dv.setFloat32(80, 2, true);
    dv.setFloat32(84, 2, true);
    dv.setFloat32(88, 3, true);
    dv.setFloat32(108, voxOffset, true);
    dv.setFloat32(112, 2, true); // scl_slope
    dv.setInt16(254, 1, true);
    dv.setFloat32(292, -123.5, true); // srow_x offset
    dv.setUint8(348, 1); // extension present
    dv.setInt32(352, 16, true);
    for (let i = 0; i < 8; i++) dv.setInt16(voxOffset + i * 2, i * 10, true);

    const { volume, nifti } = parseNifti1(buf);
    expect(Array.from(volume.data)).toEqual([0, 20, 40, 60, 80, 100, 120, 140]);
    const out = buildNiftiFromOriginalHeader(applyEdit(volume, { type: "thresholdReplace", threshold: 100, value: 1 }).volume, nifti)!;
    const odv = new DataView(out.buffer);
    expect(odv.getInt16(70, true)).toBe(16);
    expect(odv.getFloat32(292, true)).toBe(-123.5);
    expect(odv.getInt32(352, true)).toBe(16);
    const reparsed = parseNifti1(out.buffer);
    expect(Array.from(reparsed.volume.data)).toEqual([0, 20, 40, 60, 80, 1, 1, 1]);
  });
});
