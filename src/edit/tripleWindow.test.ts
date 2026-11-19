import { describe, expect, it } from "vitest";
import { TRIPLE_DEFAULTS, dilateRegion, regionTable, tripleWindow } from "./tripleWindow";

describe("triple-window CT", () => {
  it("assigns lung and bone labels", () => {
    const t = regionTable(new Map([[1, "lung upper lobe left"], [2, "rib left 3"], [3, "liver"], [4, "trachea"], [5, "vertebrae L1"]]));
    expect(Array.from(t.slice(0, 6))).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it("maps lung/bone voxels so the soft-tissue window shows them like lung/bone windows", async () => {
    const [s0, s1] = TRIPLE_DEFAULTS.soft;
    const hu = Float32Array.from([40, -1350, 150, -600, -450, 1050, 300, 3000]);
    const region = Uint8Array.from([0, 1, 1, 1, 2, 2, 2, 2]);
    const out = Array.from(await tripleWindow(hu, region));
    expect(out[0]).toBe(40); // soft tissue unchanged
    expect(out[1]).toBeCloseTo(s0); // lung window bottom → soft bottom
    expect(out[2]).toBeCloseTo(s1);
    expect(out[3]).toBeCloseTo((s0 + s1) / 2); // lung window center → soft center
    expect(out[4]).toBeCloseTo(s0);
    expect(out[5]).toBeCloseTo(s1);
    expect(out[6]).toBeCloseTo((s0 + s1) / 2);
    expect(out[7]).toBeCloseTo(s1); // clamped
  });

  it("grows a region into soft tissue only", async () => {
    // 5 × 1 × 1: [0, 1, 0, 2, 0]
    const r = Uint8Array.from([0, 1, 0, 2, 0]);
    await dilateRegion(r, [5, 1, 1], 1, 1);
    expect(Array.from(r)).toEqual([1, 1, 1, 2, 0]);
  });
});
