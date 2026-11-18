import { afterEach, describe, expect, it } from "vitest";
import { safeFileName, sanitizePatientId, setExportPatientId, umlaut, withPatientId } from "./exportName";

describe("patient ID in export file names", () => {
  afterEach(() => setExportPatientId(""));
  it("prefixes NIfTI and CSV files only", () => {
    expect(withPatientId("PET.nii")).toBe("PET.nii");
    setExportPatientId("P-0815");
    expect(withPatientId("PET.nii")).toBe("P-0815_PET.nii");
    expect(withPatientId("seg.nii.gz")).toBe("P-0815_seg.nii.gz");
    expect(withPatientId("Labelanalyse_PET.csv")).toBe("P-0815_Labelanalyse_PET.csv");
    expect(withPatientId("serie.zip")).toBe("serie.zip");
    expect(withPatientId("Histogramme.zip", { archive: true })).toBe("P-0815_Histogramme.zip");
    expect(withPatientId("ordner/a.csv")).toBe("ordner/P-0815_a.csv");
    expect(withPatientId("IM0001.dcm")).toBe("IM0001.dcm");
    expect(withPatientId("P-0815_PET.nii")).toBe("P-0815_PET.nii");
  });
  it("sanitizes the ID", () => {
    expect(sanitizePatientId("  Müller, Hans / 12 ")).toBe("Müller,_Hans_12");
    expect(sanitizePatientId("a:b*c")).toBe("a_b_c");
  });

  it("transliterates umlauts in file names", () => {
    expect(safeFileName("Läsionen · Größe")).toBe("Laesionen_Groesse");
    expect("Übersicht".replace(/[äöüÄÖÜß]/g, umlaut)).toBe("Uebersicht");
  });
});
