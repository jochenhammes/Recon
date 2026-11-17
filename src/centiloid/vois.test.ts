import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { voxelToWorld } from "../core/geometry";
import { buildZip } from "../export/zip";
import { Volume3D } from "../viewer/volume";
import { buildNiftiFile } from "../export/niftiWriter";
import { parseNifti1 } from "../viewer/volumeLoader";
import { loadVois, voiMeans, voiNameFromFile, voiVolumeMl } from "./vois";

// GAAIN data is not part of the repository (terms of use); the real-data test runs only where it was downloaded.
const GAAIN = process.env.GAAIN_DIR ?? "/tmp/claude-0/-home-user-Recon/7ae1b8b6-e17c-5cc2-908b-d4f593496bd0/scratchpad/gaain";
const geometry = { origin: [-20, -20, -20] as [number, number, number], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]], spacing: [2, 2, 2] as [number, number, number] };
const box = (f: (i: number, j: number, k: number) => number) => {
  const d = new Float32Array(20 * 20 * 20);
  for (let k = 0, o = 0; k < 20; k++) for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++, o++) d[o] = f(i, j, k);
  return new Volume3D(d, 20, 20, 20, [2, 2, 2], geometry);
};

describe("Centiloid VOIs", () => {
  it("recognizes GAAIN file names", () => {
    expect(voiNameFromFile("Centiloid_Std_VOI/nifti/2mm/voi_WhlCblBrnStm_2mm.nii")).toEqual({ name: "WhlCblBrnStm", mm: 2 });
    expect(voiNameFromFile("voi_WhlCbl_1mm.nii")).toEqual({ name: "WhlCbl", mm: 1 });
    expect(voiNameFromFile("voi_ctx_2mm.nii.gz")).toEqual({ name: "ctx", mm: 2 });
    expect(voiNameFromFile("other.nii")).toBeNull();
  });

  it("loads masks from a ZIP and computes VOI means in world coordinates", async () => {
    const ctx = box((i) => (i < 10 ? 1 : 0));
    const cbl = box((i) => (i >= 10 ? 1 : 0));
    const zip = buildZip([
      { name: "Centiloid_Std_VOI/nifti/2mm/voi_ctx_2mm.nii", bytes: buildNiftiFile(ctx) },
      { name: "Centiloid_Std_VOI/nifti/2mm/voi_WhlCbl_2mm.nii", bytes: buildNiftiFile(cbl) },
      { name: "__MACOSX/Centiloid_Std_VOI/nifti/2mm/._voi_ctx_2mm.nii", bytes: new Uint8Array(10) },
    ]);
    const vois = await loadVois([{ name: "Centiloid_Std_VOI.zip", bytes: zip }]);
    expect(Object.keys(vois.volumes).sort()).toEqual(["WhlCbl", "ctx"]);
    // Target on a shifted 4 mm grid: value = x coordinate.
    const t = new Volume3D(new Float32Array(10 * 10 * 10), 10, 10, 10, [4, 4, 4], { ...geometry, spacing: [4, 4, 4], origin: [-19, -19, -19] });
    for (let k = 0, o = 0; k < 10; k++) for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++, o++) t.data[o] = voxelToWorld(t.geometry, i, j, k)[0] < 0 ? 2 : 1;
    const means = Object.fromEntries(voiMeans(t, vois).map((m) => [m.name, m.mean]));
    expect(means.ctx).toBe(2);
    expect(means.WhlCbl).toBe(1);
  });

  it.skipIf(!existsSync(`${GAAIN}/voi/Centiloid_Std_VOI/nifti/2mm/voi_ctx_2mm.nii`))("GAAIN 2 mm VOIs lie in MNI space inside the brain", async () => {
    const dir = `${GAAIN}/voi/Centiloid_Std_VOI/nifti/2mm/`;
    const names = ["ctx", "WhlCbl", "CerebGry", "WhlCblBrnStm", "Pons"].map((n) => `voi_${n}_2mm.nii`);
    const vois = await loadVois(names.map((n) => ({ name: n, bytes: new Uint8Array(readFileSync(dir + n)) })));
    const ctx = vois.volumes.ctx!;
    expect([ctx.nx, ctx.ny, ctx.nz]).toEqual([91, 109, 91]);
    const ml = Object.fromEntries(Object.entries(vois.volumes).map(([k, v]) => [k, voiVolumeMl(v!)]));
    expect(ml.ctx).toBeGreaterThan(200);
    expect(ml.WhlCbl).toBeGreaterThan(ml.CerebGry);
    expect(ml.WhlCblBrnStm).toBeGreaterThan(ml.WhlCbl);
    // Overlap with the bundled MNI 2009c brain mask (both MNI mm coordinates).
    const raw = gunzipSync(readFileSync(fileURLToPath(new URL("../../public/templates/MNI152NLin2009cAsym_res-02_brainmask.nii.gz", import.meta.url))));
    const brain = parseNifti1(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer).volume;
    const inside = voiMeans(brain, vois);
    for (const m of inside) expect(m.mean, m.name).toBeGreaterThan(0.9);
    console.log("VOI ml", ml, "in 2009c brain mask", inside.map((m) => `${m.name} ${m.mean.toFixed(3)}`).join(", "));
  });
});
