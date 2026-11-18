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

describe("bundled SPM PET/SPECT templates", () => {
  it("load in MNI space and overlap the MNI 2009c brain", async () => {
    const { readFileSync } = await import("node:fs");
    const { gunzipSync } = await import("node:zlib");
    const { fileURLToPath } = await import("node:url");
    const { parseNifti1 } = await import("../viewer/volumeLoader");
    const { voiMeans } = await import("../centiloid/vois");
    const load = (n: string) => {
      const raw = gunzipSync(readFileSync(fileURLToPath(new URL(`../../public/templates/${n}`, import.meta.url))));
      return parseNifti1(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer).volume;
    };
    const brain = load("MNI152NLin2009cAsym_res-02_brainmask.nii.gz");
    // Transmission template (CT-like): the MNI brain lies inside the head (tissue attenuation, not air).
    const tr = load("spm12_Transm.nii.gz");
    expect([tr.nx, tr.ny, tr.nz]).toEqual([91, 109, 91]);
    let max = 0;
    for (const v of tr.data) max = Math.max(max, v);
    // Same 91×109×91 grid as the SPM PET template: its brain (> 40 % of max) must be tissue in the transmission image.
    const pet = load("spm12_PET.nii.gz");
    let pmax = 0;
    for (const v of pet.data) pmax = Math.max(pmax, v);
    let inBrain = 0, n = 0;
    for (let i = 0; i < pet.data.length; i++)
      if (pet.data[i] > 0.4 * pmax) {
        n++;
        if (tr.data[i] > 0.3 * max) inBrain++;
      }
    expect(inBrain / n).toBeGreaterThan(0.95);
    for (const f of ["spm12_PET.nii.gz", "spm12_SPECT.nii.gz"]) {
      const t = load(f);
      expect([t.nx, t.ny, t.nz]).toEqual([91, 109, 91]);
      // Mean template intensity inside vs outside the MNI 2009c brain (sampled on the template grid).
      const asMask = { resolutionMm: 2, volumes: { ctx: brain }, source: "" };
      const inside = voiMeans(t, asMask)[0].mean;
      let all = 0;
      for (const v of t.data) all += v;
      expect(inside, f).toBeGreaterThan(1.8 * (all / t.data.length));
    }
  });
});
