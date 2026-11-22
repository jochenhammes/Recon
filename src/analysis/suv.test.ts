import * as dicomParser from "dicom-parser";
import { describe, expect, it } from "vitest";
import { concatBytes } from "../export/bytes";
import { stringValue, u16le, u32le } from "../export/dicomRewriter";
import { computeSuv } from "./suv";

function el(group: number, elem: number, vr: string, value: Uint8Array): Uint8Array {
  const head = [u16le(group), u16le(elem), Uint8Array.of(vr.charCodeAt(0), vr.charCodeAt(1))];
  if (vr === "SQ") return concatBytes([...head, u16le(0), u32le(value.length), value]);
  return concatBytes([...head, u16le(value.length), value]);
}
const s = (g: number, e: number, vr: string, v: string) => el(g, e, vr, stringValue(vr, v).value);

function petHeader(opts: { units?: string; decay?: string; weight?: string; modality?: string; seriesTime?: string; acqTime?: string; gePrivate?: string } = {}) {
  const rpItem = concatBytes([
    s(0x0018, 0x1072, "TM", "075700.000000"),
    s(0x0018, 0x1074, "DS", "224000000"),
    s(0x0018, 0x1075, "DS", "6586.2"),
    s(0x0018, 0x1078, "DT", "20261113075700.000000"),
  ]);
  const seq = concatBytes([u16le(0xfffe), u16le(0xe000), u32le(rpItem.length), rpItem]);
  const bytes = concatBytes([
    s(0x0008, 0x0021, "DA", "20261113"),
    ...(opts.acqTime ? [s(0x0008, 0x0022, "DA", "20261113")] : []),
    s(0x0008, 0x0031, "TM", opts.seriesTime ?? "085944.000000"),
    ...(opts.acqTime ? [s(0x0008, 0x0032, "TM", opts.acqTime)] : []),
    s(0x0008, 0x0060, "CS", opts.modality ?? "PT"),
    ...(opts.gePrivate ? [s(0x0009, 0x100d, "DT", opts.gePrivate)] : []),
    s(0x0010, 0x1030, "DS", opts.weight ?? "70"),
    el(0x0054, 0x0016, "SQ", seq),
    s(0x0054, 0x1001, "CS", opts.units ?? "BQML"),
    s(0x0054, 0x1102, "CS", opts.decay ?? "START"),
  ]);
  return dicomParser.parseDicom(bytes, { TransferSyntaxUID: "1.2.840.10008.1.2.1" });
}

describe("computeSuv", () => {
  it("computes the body-weight SUV factor with decay correction to series start", () => {
    const r = computeSuv(petHeader());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.info.minutesToReference).toBeCloseTo(62.73, 1);
    expect(r.info.doseAtReferenceBq / 1e6).toBeCloseTo(150.7, 1);
    expect(1 / r.info.factor).toBeCloseTo(2153, 0); // Bq/ml per SUV unit
  });

  it("keeps the series time when it is not later than the acquisition (QIBA)", () => {
    const r = computeSuv(petHeader({ acqTime: "090500.000000" }));
    expect(r.ok && r.info.referenceTime).toBe("series");
    expect(r.ok && r.info.minutesToReference).toBeCloseTo(62.73, 1);
  });

  it("uses the earliest acquisition time when the series was created later (QIBA)", () => {
    // Series re-created at 10:30, images acquired from 08:59:44: reference is the earliest acquisition.
    const late = petHeader({ seriesTime: "103000.000000", acqTime: "091000.000000" });
    const early = petHeader({ seriesTime: "103000.000000", acqTime: "085944.000000" });
    const r = computeSuv(late, { all: [late, early] });
    expect(r.ok && r.info.referenceTime).toBe("acquisition");
    expect(r.ok && r.info.minutesToReference).toBeCloseTo(62.73, 1);
  });

  it("prefers the GE private scan time for a later series", () => {
    const r = computeSuv(petHeader({ seriesTime: "103000.000000", acqTime: "091000.000000", gePrivate: "20261113085944.000000" }));
    expect(r.ok && r.info.referenceTime).toBe("ge-private");
    expect(r.ok && r.info.minutesToReference).toBeCloseTo(62.73, 1);
  });

  it("uses the injected dose for ADMIN decay correction", () => {
    const r = computeSuv(petHeader({ decay: "ADMIN" }));
    expect(r.ok && r.info.factor).toBeCloseTo(70000 / 224e6, 12);
  });

  it("reports why SUV is unavailable", () => {
    expect(computeSuv(petHeader({ units: "CNTS" }))).toMatchObject({ ok: false });
    expect(computeSuv(petHeader({ weight: "" }))).toMatchObject({ ok: false });
    expect(computeSuv(petHeader({ modality: "NM" }))).toMatchObject({ ok: false });
  });
});
