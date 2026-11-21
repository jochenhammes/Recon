import { describe, expect, it } from "vitest";
import { doseUncertainty } from "./uncertainty";

describe("dose uncertainty (EANM 2018)", () => {
  it("adds independent contributions in quadrature", () => {
    const u = doseUncertainty({ doseGy: 10, tia: 100, tiaSd: 3, rcApplied: true, inputs: { calibrationPct: 4, rcPct: 12, volumePct: 0 } })!;
    expect(u.parts.map((p) => p.label)).toEqual(["Kurvenfit", "Kalibrierung", "Recovery"]);
    expect(u.rel).toBeCloseTo(Math.sqrt(0.03 ** 2 + 0.04 ** 2 + 0.12 ** 2), 12);
    expect(u.sdGy).toBeCloseTo(10 * u.rel, 12);
  });
  it("ignores RC when not applied and returns nothing without inputs", () => {
    expect(doseUncertainty({ doseGy: 5, tia: 1, rcApplied: false, inputs: { rcPct: 10, volumePct: 5 } })!.rel).toBeCloseTo(0.05, 12);
    expect(doseUncertainty({ doseGy: 5, tia: 1, rcApplied: false })).toBeUndefined();
  });
});
