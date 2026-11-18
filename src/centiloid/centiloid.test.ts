import dicomParser from "dicom-parser";
import { describe, expect, it } from "vitest";
import { CALIBRATIONS, acquisitionWindow, centiloidFromMeans, computeCentiloid, guessTracer, windowWarning } from "./centiloid";

const fbb = CALIBRATIONS.find((c) => c.id === "fbb-rowe2017")!;
const pib = CALIBRATIONS.find((c) => c.id === "pib-klunk2015")!;

/** Fake DataSet with string tags and one Radiopharmaceutical sequence item. */
function ds(tags: Record<string, string>, rp: Record<string, string>): dicomParser.DataSet {
  const mk = (t: Record<string, string>, extra: Record<string, unknown> = {}) =>
    ({ string: (tag: string) => t[tag], elements: extra }) as unknown as dicomParser.DataSet;
  return mk(tags, { x00540016: { items: [{ dataSet: mk(rp) }] } });
}

describe("Centiloid", () => {
  it("PiB anchors: SUVR 1.009 → 0 CL, 2.076 → 100 CL", () => {
    expect(computeCentiloid(1.009, pib)).toBeCloseTo(0, 6);
    expect(computeCentiloid(1.009 + 1.067, pib)).toBeCloseTo(100, 6);
  });

  it("Florbetaben after Rowe 2017", () => {
    expect(computeCentiloid(1, fbb)).toBeCloseTo(-1.5, 6);
    expect(computeCentiloid(1.6, fbb)).toBeCloseTo(153.4 * 1.6 - 154.9, 6);
    const r = centiloidFromMeans(
      [
        { name: "ctx", mean: 1.5, voxels: 1, volumeMl: 1 },
        { name: "WhlCbl", mean: 1, voxels: 1, volumeMl: 1 },
        { name: "Pons", mean: 1.25, voxels: 1, volumeMl: 1 },
      ],
      fbb,
    );
    expect(r.suvr.WhlCbl).toBe(1.5);
    expect(r.suvr.Pons).toBe(1.2);
    expect(r.centiloid).toBeCloseTo(153.4 * 1.5 - 154.9, 6);
  });

  it("reads the acquisition window and flags mismatches", () => {
    const w = acquisitionWindow(ds({ x00080021: "20240101", x00080031: "103000", x00181242: "300000", x00540101: "4" }, { x00181072: "090000", x00180031: "Florbetaben" }));
    expect(w).toEqual({ startMin: 90, endMin: 110, tracerName: "Florbetaben" });
    expect(windowWarning(w as never, fbb)).toBeNull();
    expect(windowWarning({ startMin: 60, endMin: 80 }, fbb)).toContain("90–110");
    expect(guessTracer("Neuraceq (Florbetaben F18)")).toBe("FBB");
    expect(guessTracer("FDG")).toBeNull();
    expect("reason" in acquisitionWindow(ds({}, {}))).toBe(true);
  });
});

describe("pipeline calibrations", () => {
  it("defaults to the GAAIN-calibrated equation of the app pipeline", async () => {
    const { CALIBRATIONS, computeCentiloid } = await import("./centiloid");
    const fbb = CALIBRATIONS[0];
    expect(fbb.id).toBe("fbb-recon");
    expect(fbb.pipeline).toBe("recon");
    // GAAIN subject 2032: app SUVR (whole cerebellum) 1.4197, standard-method CL 58.3
    expect(Math.abs(computeCentiloid(1.4197, fbb) - 58.3)).toBeLessThan(5);
    expect(CALIBRATIONS.filter((c) => c.pipeline === "standard").map((c) => c.id)).toEqual(["fbb-rowe2017", "pib-klunk2015"]);
  });
});
