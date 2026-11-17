import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseNifti1 } from "../viewer/volumeLoader";
import { REFERENCE_PRESETS, atlasFromLabels, parseLabelTable, pooledMean, presetIndices, regionCsv, regionStats } from "./atlas";

const pub = (p: string) => fileURLToPath(new URL(`../../public/${p}`, import.meta.url));
const nifti = (p: string) => {
  const raw = gunzipSync(readFileSync(pub(p)));
  return parseNifti1(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer).volume;
};

describe("label tables", () => {
  it("reads TSV, CSV, FSL/FreeSurfer LUT and ITK-SNAP formats", () => {
    expect([...parseLabelTable("index\tname\n1\tLeft Hippocampus\n2\tRight Hippocampus\n")]).toEqual([[1, "Left Hippocampus"], [2, "Right Hippocampus"]]);
    expect([...parseLabelTable("1,Frontal lobe,x\n2;Occipital\n")]).toEqual([[1, "Frontal lobe"], [2, "Occipital"]]);
    expect([...parseLabelTable("# LUT\n0 Unknown 0 0 0 0\n8 Left-Cerebellum-Cortex 230 148 34 0\n")]).toEqual([[8, "Left-Cerebellum-Cortex"]]);
    expect([...parseLabelTable('# ITK-SNAP\n 5   255 0 0   1 1 1  "Pons"\n')]).toEqual([[5, "Pons"]]);
  });
});

describe("regional statistics and SUVR", () => {
  it("computes region means, reference region and SUVR on a phantom", () => {
    const labels = Float32Array.from([1, 1, 2, 2, 2, 3, 0, 0]);
    const values = Float32Array.from([2, 4, 1, 1, 1, 10, 99, 99]);
    const atlas = atlasFromLabels(labels, "phantom", new Map([[1, "Cortex"], [2, "Cerebellum Gray Matter L"], [3, "Pons"]]));
    const stats = regionStats(values, labels, atlas, 0.008);
    const by = Object.fromEntries(stats.map((s) => [s.name, s]));
    expect(by.Cortex.mean).toBe(3);
    expect(by.Cortex.median).toBe(3);
    expect(by.Cortex.volumeMl).toBeCloseTo(0.016, 10);
    expect(by.Pons.voxels).toBe(1);
    const ref = pooledMean(stats, presetIndices(atlas, REFERENCE_PRESETS[0]));
    expect(ref).toBe(1);
    expect(pooledMean(stats, presetIndices(atlas, REFERENCE_PRESETS[3]))).toBeCloseTo((2 + 4 + 3 + 10) / 6, 10);
    const csv = regionCsv(stats, ref, { dataset: "d", atlas: "a", reference: "r", unit: "Bq/ml" });
    expect(csv).toContain('1;"Cortex";2;0,02;3,0000;3,0000');
    expect(csv.trim().split("\n").at(-1)!.endsWith("10,0000")).toBe(true);
  });

  it("bundled CerebrA atlas lies on the template grid and inside the brain", () => {
    const atlas = nifti("atlases/CerebrA_MNI152NLin2009cAsym_res-02_dseg.nii.gz");
    const mask = nifti("templates/MNI152NLin2009cAsym_res-02_brainmask.nii.gz");
    expect([atlas.nx, atlas.ny, atlas.nz]).toEqual([mask.nx, mask.ny, mask.nz]);
    atlas.geometry.origin.forEach((v, i) => expect(v).toBeCloseTo(mask.geometry.origin[i], 3));
    let labelled = 0, inside = 0;
    for (let i = 0; i < atlas.data.length; i++)
      if (atlas.data[i] > 0) {
        labelled++;
        if (mask.data[i] > 0.5) inside++;
      }
    expect(inside / labelled).toBeGreaterThan(0.95);
    const table = parseLabelTable(readFileSync(pub("atlases/CerebrA_labels.tsv"), "utf8"));
    expect(table.size).toBe(102);
    const info = { name: "CerebrA", labels: table };
    expect(presetIndices(info, REFERENCE_PRESETS[0]).size).toBe(2);
    expect(presetIndices(info, REFERENCE_PRESETS[1]).size).toBe(10);
  });
});
