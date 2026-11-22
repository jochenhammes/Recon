import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseFslAtlasXml, parseLabelTable } from "../atlas/atlas";
import { parseNifti1 } from "../viewer/volumeLoader";
import { BUNDLED, CATALOG, bundledEntry, defaultTemplateId, identifyUserFiles } from "./catalog";
import { cacheUserFiles, cachedEntryIds, cachedUserFiles } from "./userCache";

const pub = (p: string) => `${__dirname}/../../public/${p}`;
const nifti = (p: string) => {
  const b = readFileSync(pub(p));
  const raw = b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b;
  return parseNifti1(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
};

describe("brain catalogue", () => {
  it("has unique ids", () => {
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length);
  });

  it("every bundled file, mask, table and licence file exists", () => {
    for (const e of BUNDLED) {
      for (const p of [e.file, e.mask, e.table, e.license.url].filter((x): x is string => !!x && !/^https?:/.test(x))) expect(existsSync(pub(p)), `${e.id}: ${p}`).toBe(true);
    }
  });

  it("bundled images load with the stated resolution, masks match their grid, atlases have labels", { timeout: 60000 }, () => {
    for (const e of BUNDLED) {
      const img = nifti(e.file);
      const sp = img.volume.geometry.spacing;
      expect(Math.abs(sp[0] - e.resolutionMm), e.id).toBeLessThan(0.01);
      if (e.mask) {
        const m = nifti(e.mask);
        expect([m.volume.nx, m.volume.ny, m.volume.nz]).toEqual([img.volume.nx, img.volume.ny, img.volume.nz]);
      }
      if (e.table) {
        const labels = parseLabelTable(readFileSync(pub(e.table), "utf8"));
        const present = new Set<number>();
        for (const v of img.volume.data) if (v > 0) present.add(Math.round(v));
        expect(labels.size, e.id).toBeGreaterThan(5);
        // Every label in the image has a name.
        for (const l of present) expect(labels.has(l), `${e.id}: Label ${l}`).toBe(true);
      }
      if (e.group === "tpm") {
        let mx = 0;
        for (const v of img.volume.data) if (v > mx) mx = v;
        expect(mx).toBeGreaterThan(0.95);
        expect(mx).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it("recognises user downloads by file name", () => {
    expect(identifyUserFiles(["x/HarvardOxford-cort-maxprob-thr25-1mm.nii.gz", "HarvardOxford-Cortical.xml"])).toMatchObject({ entry: { id: "ho-cort" }, table: "HarvardOxford-Cortical.xml" });
    expect(identifyUserFiles(["HarvardOxford-sub-maxprob-thr50-2mm.nii.gz"])?.entry.id).toBe("ho-sub");
    expect(identifyUserFiles(["BN_Atlas_246_1mm.nii.gz", "BN_Atlas_246_LUT.txt"])).toMatchObject({ entry: { id: "brainnetome" }, table: "BN_Atlas_246_LUT.txt" });
    expect(identifyUserFiles(["AAL3v1_1mm.nii.gz", "AAL3v1_1mm.nii.txt"])).toMatchObject({ entry: { id: "aal3" }, table: "AAL3v1_1mm.nii.txt" });
    expect(identifyUserFiles(["tpl-MNI152NLin2009cAsym_res-01_atlas-HOCPA_desc-th25_dseg.nii.gz", "tpl-MNI152NLin2009cAsym_atlas-HOCPA_dseg.tsv"])?.entry.id).toBe("ho-tf");
    expect(identifyUserFiles(["patient.nii.gz"])).toBeNull();
  });

  it("parses FSL atlas XML (0-based index → image value + 1)", () => {
    const xml = `<?xml version="1.0"?><atlas><data><label index="0" x="1" y="2" z="3">Frontal Pole</label>\n<label index="1" x="1" y="2" z="3">Insular Cortex</label><label index="2">Caudate &amp; Putamen</label></data></atlas>`;
    expect([...parseFslAtlasXml(xml)]).toEqual([[1, "Frontal Pole"], [2, "Insular Cortex"], [3, "Caudate & Putamen"]]);
  });

  it("chooses the template by contrast and tracer", () => {
    expect(defaultTemplateId({ kind: "T1", modality: "MR" })).toBe("mni-t1-2");
    expect(defaultTemplateId({ kind: "CT", modality: "CT" })).toBe("spm-transm");
    expect(defaultTemplateId({ kind: "PET", modality: "NM", tracerHint: "DaTSCAN 123I-Ioflupane" })).toBe("gg-fpcit");
    expect(defaultTemplateId({ kind: "PET", modality: "PT", tracerHint: "Fluorodeoxyglucose" })).toBe("magia-fdg");
    expect(defaultTemplateId({ kind: "PET", modality: "PT", tracerHint: "Florbetaben" })).toBe("magia-pib");
    expect(defaultTemplateId({ kind: "PET", modality: "PT", tracerHint: "6-[18F]Fluoro-L-DOPA" })).toBe("gg-fdopa");
    expect(defaultTemplateId({ kind: "PET", modality: "NM" })).toBe("spm-spect");
    for (const id of ["mni-t1-2", "spm-transm", "gg-fpcit", "magia-fdg", "magia-pib", "gg-fdopa", "spm-spect"]) expect(bundledEntry(id)).toBeDefined();
  });

  it("user cache degrades gracefully without the Cache API", async () => {
    expect(await cacheUserFiles("ho-cort", [new File(["x"], "a.nii")])).toBe(false);
    expect(await cachedEntryIds()).toEqual([]);
    expect(await cachedUserFiles("ho-cort")).toBeNull();
  });
});
