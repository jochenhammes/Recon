import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { voxelToWorld } from "../core/geometry";
import { parseNifti1 } from "../viewer/volumeLoader";

const load = (name: string) => {
  const gz = readFileSync(fileURLToPath(new URL(`../../public/templates/${name}`, import.meta.url)));
  const raw = gunzipSync(gz);
  return parseNifti1(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer).volume;
};

describe("bundled MNI template", () => {
  it("loads with MNI geometry (2 mm, origin at the anterior commissure)", () => {
    const t1 = load("MNI152NLin2009cAsym_res-02_T1w.nii.gz");
    expect([t1.nx, t1.ny, t1.nz]).toEqual([97, 115, 97]);
    expect(t1.geometry.spacing).toEqual([2, 2, 2]);
    // RAS (-96.5, -132.5, -78.5) → LPS (96.5, 132.5, -78.5)
    expect(voxelToWorld(t1.geometry, 0, 0, 0)).toEqual([96.5, 132.5, -78.5]);
    const mask = load("MNI152NLin2009cAsym_res-02_brainmask.nii.gz");
    const inBrain = mask.data.filter((v) => v > 0.5).length * 8 / 1000;
    expect(inBrain).toBeGreaterThan(1200); // ml
    expect(inBrain).toBeLessThan(2000);
  });
});
