import * as dicomParser from "dicom-parser";
import { describe, expect, it } from "vitest";
import type { DicomSourceFile } from "../dataset/types";
import { type DicomSource, buildEditedDicomFiles } from "../export/editedDicomExport";
import { buildTemplateSeries } from "../export/templateDicomWriter";
import { asFile, buildPart10 } from "../test/dicomFixtures";
import { loadVolumeFromFiles } from "../viewer/volumeLoader";
import { formatTag, lookupTag, parseTag } from "./dictionary";
import { type HeaderEdit, headerRows, lockReason, validateValue } from "./headerModel";

describe("dictionary", () => {
  it("names tags and parses tag input", () => {
    expect(lookupTag("x00100010")).toEqual({ vr: "PN", name: "Patient Name" });
    expect(lookupTag("x0008103e")?.name).toBe("Series Description");
    expect(lookupTag("x00291010")?.name).toBe("Private Tag");
    expect(parseTag("(0010,1030)")).toBe("x00101030");
    expect(parseTag("0010,103")).toBeNull();
    expect(formatTag("x0008103e")).toBe("(0008,103E)");
  });
});

describe("validateValue", () => {
  it("checks VR formats", () => {
    expect(validateValue("DA", "20261113")).toBeNull();
    expect(validateValue("DA", "13.11.2026")).not.toBeNull();
    expect(validateValue("DS", "72.5")).toBeNull();
    expect(validateValue("DS", "1\\2.5\\-3e2")).toBeNull();
    expect(validateValue("DS", "abc")).not.toBeNull();
    expect(validateValue("CS", "head first")).not.toBeNull();
    expect(validateValue("UI", "1.2.03")).not.toBeNull();
    expect(validateValue("LO", "x".repeat(65))).not.toBeNull();
    expect(validateValue("AS", "056Y")).toBeNull();
    expect(validateValue("US", "70000")).not.toBeNull();
  });

  it("locks tags the export manages", () => {
    expect(lockReason("x7fe00010")).toBeDefined();
    expect(lockReason("x00280030")).toBeDefined();
    expect(lockReason("x00200032")).toBeDefined();
    expect(lockReason("x00100010")).toBeUndefined();
  });
});

describe("header edits in exports", () => {
  const series = () =>
    loadVolumeFromFiles([1, 2].map((n) => asFile(buildPart10({ rows: 2, cols: 2, frames: 1, pixels: [n, n, n, n], instanceNumber: n }), `f${n}.dcm`)));

  it("lists rows with names and editability", async () => {
    const { source } = await series();
    const file = (source as { files: DicomSourceFile[] }).files[0];
    const rows = headerRows(file.dataSet, true);
    const name = rows.find((r) => r.tag === "x00100010")!;
    expect(name).toMatchObject({ name: "Patient Name", vr: "PN", value: "Doe^Jane", editable: true });
    expect(rows.find((r) => r.tag === "x7fe00010")!.editable).toBe(false);
    expect(rows.find((r) => r.tag === "x00540022")!.items).toHaveLength(1);
  });

  it("applies edits for all files, single files, deletions and new tags", async () => {
    const { volume, source } = await series();
    const edits: HeaderEdit[] = [
      { tag: "x00100010", vr: "PN", value: "Muster^Max", scope: "all" },
      { tag: "x0008103e", vr: "LO", value: "Nur Datei 2", scope: 1 },
      { tag: "x00291010", vr: "OB", value: null, scope: "all" },
      { tag: "x00101030", vr: "DS", value: "81.5", scope: "all" },
      { tag: "x7fe00010", vr: "OW", value: null, scope: "all" }, // locked: ignored
    ];
    const { files } = buildEditedDicomFiles(volume, source as DicomSource, { headerEdits: edits });
    const ds = files.map((f) => dicomParser.parseDicom(f.bytes));
    expect(ds.map((d) => d.string("x00100010"))).toEqual(["Muster^Max", "Muster^Max"]);
    expect(ds.map((d) => d.string("x0008103e"))).toEqual(["SPECT AC", "Nur Datei 2"]);
    expect(ds[0].elements["x00291010"]).toBeUndefined();
    expect(ds[1].string("x00101030")).toBe("81.5");
    expect(ds[0].elements["x7fe00010"]).toBeDefined();

    const reloaded = await loadVolumeFromFiles(files.map((f) => asFile(f.bytes, f.name)));
    expect(Array.from(reloaded.volume.data)).toEqual(Array.from(volume.data));
  });

  it("applies edits in the template writer, overriding generated descriptions", async () => {
    const { volume, source } = await series();
    const { files } = buildTemplateSeries(volume, (source as { files: DicomSourceFile[] }).files[0], {
      seriesDescription: "auto",
      headerEdits: [{ tag: "x0008103e", vr: "LO", value: "Eigene Beschreibung", scope: "all" }],
    });
    expect(dicomParser.parseDicom(files[1].bytes).string("x0008103e")).toBe("Eigene Beschreibung");
  });
});
