import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as dicomParser from "dicom-parser";
import { describe, expect, it } from "vitest";
import { applyEdit } from "../edit/operations";
import { loadVolumeFromFiles, parseNifti1 } from "../viewer/volumeLoader";
import { type El, asFile, buildPart10, enc, item, rawElement, s } from "../test/dicomFixtures";
import { concatBytes } from "./bytes";
import { IMPLICIT_VR_LE } from "./dicomRewriter";
import { type DicomSource, buildEditedDicomFiles } from "./editedDicomExport";
import { buildNiftiFromOriginalHeader } from "./niftiWriter";
import { buildZip } from "./zip";

async function exportRoundTrip(files: File[], threshold: number, value: number, adjustWindow = true) {
  const loaded = await loadVolumeFromFiles(files);
  const edited = applyEdit(loaded.volume, { type: "thresholdReplace", threshold, value }).volume;
  const result = buildEditedDicomFiles(edited, loaded.source as DicomSource, {
    seriesDescriptionSuffix: " [bearbeitet]",
    derivationDescription: "test edit",
    adjustWindow,
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
    expect(ds.uint16("x00280106")).toBe(0); // Smallest/Largest pixel values rewritten for the edited data
    expect(ds.uint16("x00280107")).toBe(50);
    expect(ds.uint16("x00280109")).toBe(50);
    expect(ds.string("x00281050")).toBe("25"); // window re-derived from the new range 0..50
    expect(ds.string("x00281051")).toBe("50");
    expect(ds.elements["x00281053"]).toBeUndefined(); // no rescale tags added
    expect(ds.uint32("x00020000")).toBe(ds.elements["x00020010"].dataOffset + ds.elements["x00020010"].length - 144);
    expect(ds.elements["x00540022"].items).toHaveLength(1);
  });

  it("keeps the original window when window adjustment is off", async () => {
    const { result } = await exportRoundTrip([asFile(original, "a.dcm")], 60, 5, false);
    const out = result.files[0].bytes;
    expect(rawElement(out, "x00281050")).toEqual(rawElement(original, "x00281050"));
    expect(rawElement(out, "x00281051")).toEqual(rawElement(original, "x00281051"));
  });

  it("writes pixel range tags in stored units and the window in real units after rescaling", async () => {
    const { result } = await exportRoundTrip([asFile(original, "a.dcm")], 100, -5);
    const ds = dicomParser.parseDicom(result.files[0].bytes);
    // intercept -5, slope 1: real -5..90 → stored 0..95
    expect(ds.uint16("x00280106")).toBe(0);
    expect(ds.uint16("x00280107")).toBe(95);
    expect(ds.string("x00281050")).toBe("42.5");
    expect(ds.string("x00281051")).toBe("95");
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

  it("rounds an off-grid value to the original grid instead of rescaling", async () => {
    const withSlope = buildPart10({ rows: 2, cols: 3, frames: 2, pixels, slope: 0.37, intercept: 0 });
    const { loaded, result, reloaded } = await exportRoundTrip([asFile(withSlope, "a.dcm")], 30, 10);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("auf das Original-Werteraster gerundet");
    const ds = dicomParser.parseDicom(result.files[0].bytes);
    expect(ds.string("x00281053")).toBe("0.37");
    expect(ds.string("x00281052")).toBe("0");
    reloaded.volume.data.forEach((v, i) => {
      if (loaded.volume.data[i] >= 30) expect(Math.abs(v - 10)).toBeLessThanOrEqual(0.185 + 1e-6);
      else expect(v).toBe(loaded.volume.data[i]);
    });
  });

  it("keeps intercept 0 when rescaling is unavoidable", async () => {
    const withSlope = buildPart10({ rows: 2, cols: 3, frames: 2, pixels, slope: 0.5, intercept: 0 });
    const { result, reloaded } = await exportRoundTrip([asFile(withSlope, "a.dcm")], 50, 100000.5);
    const ds = dicomParser.parseDicom(result.files[0].bytes);
    expect(ds.string("x00281052")).toBe("0");
    const slope = parseFloat(ds.string("x00281053")!);
    expect(slope * 65535).toBeGreaterThanOrEqual(100000.5);
    expect(Math.abs(reloaded.volume.data[11] - 100000.5)).toBeLessThanOrEqual(slope / 2 + 1e-3);
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

describe("anonymization", () => {
  const identifying: El[] = [
    { tag: [0x0008, 0x0050], vr: "SH", value: s("SH", "ACC123456") },
    { tag: [0x0008, 0x0070], vr: "LO", value: s("LO", "ACME MEDICAL") },
    { tag: [0x0008, 0x0080], vr: "LO", value: s("LO", "Uniklinik Musterstadt") },
    { tag: [0x0008, 0x0090], vr: "PN", value: s("PN", "Dr^Referrer") },
    { tag: [0x0008, 0x1010], vr: "SH", value: s("SH", "PETCT01") },
    { tag: [0x0008, 0x1030], vr: "LO", value: s("LO", "PET Ganzkoerper Musterstadt") },
    { tag: [0x0008, 0x1070], vr: "PN", value: s("PN", "Operator^Olga") },
    { tag: [0x0008, 0x1090], vr: "LO", value: s("LO", "SuperScan 9000") },
    { tag: [0x0008, 0x1110], vr: "SQ", value: item(enc({ tag: [0x0008, 0x1155], vr: "UI", value: s("UI", "9.9.9.9") }, true)) },
    { tag: [0x0010, 0x0020], vr: "LO", value: s("LO", "PID-777") },
    { tag: [0x0010, 0x0030], vr: "DA", value: s("DA", "19700101") },
    { tag: [0x0010, 0x1030], vr: "DS", value: s("DS", "72.5") },
    { tag: [0x0018, 0x1000], vr: "LO", value: s("LO", "SN-424242") },
    { tag: [0x0018, 0x1020], vr: "LO", value: s("LO", "VG80B") },
    { tag: [0x0020, 0x0052], vr: "UI", value: s("UI", "1.2.3.555") },
    {
      tag: [0x0054, 0x0016],
      vr: "SQ",
      value: item(
        concatBytes([
          enc({ tag: [0x0008, 0x3012], vr: "UI", value: s("UI", "1.3.12.2.1107.5.1.4.10043.20261113075700123") }, true),
          enc({ tag: [0x0018, 0x1074], vr: "DS", value: s("DS", "350000000") }, true),
        ]),
      ),
    },
  ];
  const mk = (n: number) =>
    asFile(buildPart10({ rows: 2, cols: 2, frames: 1, pixels: [n, n, n, n], instanceNumber: n, extra: identifying }), `69094${n}.dcm`);

  it("removes patient, operator and device information everywhere in the file", async () => {
    const loaded = await loadVolumeFromFiles([mk(1), mk(2)]);
    const { files } = buildEditedDicomFiles(loaded.volume, loaded.source as DicomSource, {
      anonymize: { pseudonym: "TEST01", retainPatientCharacteristics: true },
    });
    expect(files.map((f) => f.name)).toEqual(["IM00001.dcm", "IM00002.dcm"]);

    const forbidden = ["Doe^Jane", "PID-777", "ACC123456", "ACME", "Musterstadt", "Referrer", "Olga", "PETCT01",
      "SuperScan", "SN-424242", "VG80B", "19700101", "VENDOR PRIVATE", "SPECT AC", "1.2.3.100", "1.2.3.555", "9.9.9.9",
      "1.3.12.2.1107", "10043"];
    const datasets = files.map((f) => {
      const text = new TextDecoder("latin1").decode(f.bytes);
      for (const word of forbidden) expect(text, word).not.toContain(word);
      return dicomParser.parseDicom(f.bytes);
    });

    const ds = datasets[0];
    expect(ds.string("x00100010")).toBe("TEST01");
    expect(ds.string("x00100020")).toBe("TEST01");
    expect(ds.elements["x00100030"].length).toBe(0); // Type 2: kept but empty
    expect(ds.elements["x00080070"].length).toBe(0);
    expect(ds.elements["x00081090"]).toBeUndefined();
    expect(ds.elements["x00291010"]).toBeUndefined();
    expect(ds.elements["x00081110"]).toBeUndefined();
    expect(ds.string("x00101030")).toBe("72.5"); // weight retained for SUV
    expect(ds.elements["x00540016"].items).toHaveLength(1); // radiopharmaceutical info kept
    const rp = ds.elements["x00540016"].items![0].dataSet!;
    expect(rp.string("x00181074")).toBe("350000000");
    const eventUid = rp.string("x00083012")!;
    expect(eventUid).toMatch(/^2\.25\.[1-9][0-9]*$/);
    expect(eventUid).toHaveLength("1.3.12.2.1107.5.1.4.10043.20261113075700123".length);
    // Same nested UID → same replacement in every file of the series.
    expect(datasets[1].elements["x00540016"].items![0].dataSet!.string("x00083012")).toBe(eventUid);
    expect(ds.string("x00120062")).toBe("YES");
    // Replacement UIDs are consistent across the series.
    expect(datasets[1].string("x0020000d")).toBe(ds.string("x0020000d"));
    expect(datasets[1].string("x00200052")).toBe(ds.string("x00200052"));
    expect(datasets[1].string("x0020000e")).toBe(ds.string("x0020000e"));

    const reloaded = await loadVolumeFromFiles(files.map((f) => asFile(f.bytes, f.name)));
    expect(Array.from(reloaded.volume.data)).toEqual(Array.from(loaded.volume.data));
  });

  it("can drop patient characteristics too", async () => {
    const loaded = await loadVolumeFromFiles([mk(1)]);
    const { files } = buildEditedDicomFiles(loaded.volume, loaded.source as DicomSource, {
      anonymize: { pseudonym: "X", retainPatientCharacteristics: false },
    });
    const ds = dicomParser.parseDicom(files[0].bytes);
    expect(ds.elements["x00101030"]).toBeUndefined();
  });
});

describe("sameLengthUid", () => {
  it("produces valid UIDs of the requested length", async () => {
    const { sameLengthUid } = await import("./anonymize");
    for (let len = 7; len <= 64; len++) {
      const uid = sameLengthUid(len);
      expect(uid).toHaveLength(len);
      expect(uid).toMatch(/^2\.25\.[1-9][0-9]*(\.[1-9][0-9]*)?$/);
      expect(BigInt(uid.split(".")[2]) < 2n ** 128n).toBe(true);
    }
  });
});
