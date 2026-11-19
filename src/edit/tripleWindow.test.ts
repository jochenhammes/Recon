import { describe, expect, it } from "vitest";
import { TRIPLE_DEFAULTS, regionTable, tripleWindow } from "./tripleWindow";

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

  it("adds black rims: lungs on both sides of the border, bones only outside", async () => {
    const { addRims } = await import("./tripleWindow");
    // 9 × 1 × 1: soft, lung×3, soft, bone×2, soft, soft
    const r = Uint8Array.from([0, 1, 1, 1, 0, 2, 2, 0, 0]);
    await addRims(r, [9, 1, 1], 2, 1);
    expect(Array.from(r)).toEqual([3, 3, 1, 3, 4, 2, 2, 4, 0]);
    const out = await tripleWindow(Float32Array.from([40, -800, -800, -800, 40, 800, 800, 40, 40]), r);
    expect(out[0]).toBe(TRIPLE_DEFAULTS.soft[0]); // rim black
    expect(out[8]).toBe(40);
  });
});

describe("region map on the CT grid", () => {
  it("reads organ labels by nearest neighbour through the geometry (coarser organ grid, offset)", async () => {
    const { regionOnGrid } = await import("./tripleWindow");
    const { identityGeometry, worldToVoxelTransform } = await import("../core/geometry");
    // Organ grid: 2 × 1 × 1 voxels of 4 mm; label 1 = lung, label 2 = rib.
    const og = identityGeometry([4, 4, 4]);
    const organs = { nx: 2, ny: 1, nz: 1, data: Uint8Array.from([1, 2]) };
    // CT grid: 4 × 1 × 1 voxels of 2 mm starting at x = −1 → centers −1, 1, 3, 5 → organ voxels ≈ −0.25, 0.25, 0.75, 1.25.
    const ct = { nx: 4, ny: 1, nz: 1, geometry: { ...identityGeometry([2, 2, 2]), origin: [-1, 0, 0] as [number, number, number] } };
    const table = regionTable(new Map([[1, "lung lower lobe left"], [2, "rib left 1"]]));
    const r = await regionOnGrid(organs, worldToVoxelTransform(og), ct, table);
    expect(Array.from(r)).toEqual([1, 1, 2, 2]);
  });
});
