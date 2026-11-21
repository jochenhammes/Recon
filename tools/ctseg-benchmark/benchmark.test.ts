/**
 * Benchmark of the CT segmentation models of Recon Studio against reference segmentations (e.g. AMOS 2022).
 * Uses exactly the app's pipeline (RAS resampling, normalization, sliding window, top-k head) with
 * onnxruntime-web (CPU/WASM) in Node; predictions are resampled (nearest neighbour) onto the reference grid.
 *
 *   DATA=<dir with imagesVa/ labelsVa/ dataset.json>  MODELS=totalseg-total-3mm,monai-segresnet-3mm  N=10  OUT=<dir>
 *   npx vitest run --config tools/ctseg-benchmark/vitest.config.ts
 *
 * Optional ORT_NODE=<path to an onnxruntime-node installation> runs the same ONNX graph with native CPU kernels
 * (several times faster; same pre-/postprocessing), e.g. for the 1.5 mm models.
 *
 * Writes OUT/results.csv (one row per case × model × structure) and OUT/report.md.
 * Reference data is never part of the repository (see README.md).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import * as ort from "onnxruntime-web";
import { it } from "vitest";
import { worldToVoxelTransform } from "../../src/core/geometry";
import { resampleInto } from "../../src/resample/resample";
import { slidingWindow } from "../../src/segmentation/infer";
import { compareLabelMaps, type StructureScore } from "../../src/segmentation/metrics";
import { type ModelMeta, normalizeForModel, rasGrid, transposePatch } from "../../src/segmentation/preprocess";
import { parseNifti1 } from "../../src/viewer/volumeLoader";

const DATA = process.env.DATA ?? "";
const OUT = process.env.OUT ?? "ctseg-benchmark-out";
const MODELS = (process.env.MODELS ?? "totalseg-total-3mm,monai-segresnet-3mm").split(",");
const N = Number(process.env.N ?? 10);
const ROOT = new URL("../../", import.meta.url).pathname;
// Inference runtime: onnxruntime-web (WASM, as in the browser's CPU mode) or onnxruntime-node (native CPU).
const RT: typeof ort = process.env.ORT_NODE ? createRequire(import.meta.url)(process.env.ORT_NODE) : ort;
const RUNTIME = process.env.ORT_NODE ? "onnxruntime-node (native CPU)" : "onnxruntime-web (CPU/WASM)";

const nii = (f: string) => {
  let r: Uint8Array = readFileSync(f);
  if (f.endsWith(".gz")) r = gunzipSync(r);
  return parseNifti1(r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength) as ArrayBuffer).volume;
};

async function loadModel(dir: string) {
  const base = join(ROOT, "public/models", dir);
  const meta: ModelMeta = JSON.parse(readFileSync(join(base, "model.json"), "utf8"));
  const bytes = Buffer.concat(meta.parts.map((p) => readFileSync(join(base, p))));
  const session = await RT.InferenceSession.create(bytes, process.env.ORT_NODE ? { executionProviders: ["cpu"], intraOpNumThreads: cpus().length } : { executionProviders: ["wasm"] });
  return { meta, session, mb: bytes.length / 1e6 };
}

type Model = Awaited<ReturnType<typeof loadModel>>;

async function segment(ct: ReturnType<typeof nii>, { meta, session }: Model) {
  const grid = rasGrid(ct, meta.spacing[0]);
  const data = resampleInto(ct, worldToVoxelTransform(ct.geometry), grid, "linear");
  const bodyThreshold = normalizeForModel(data, meta.normalization);
  const [pz, py, px] = meta.patchSize;
  const xyz = meta.axisOrder === "xyz";
  let tiles = 0;
  const t0 = performance.now();
  const labels = await slidingWindow(
    data,
    [grid.nx, grid.ny, grid.nz],
    meta.patchSize,
    Object.keys(meta.labels).length,
    async (input) => {
      const inp = xyz ? transposePatch(input, [px, py, pz], 1, true) : input;
      const out = await session.run({ input: new RT.Tensor("float32", inp, xyz ? [1, 1, px, py, pz] : [1, 1, pz, py, px]) });
      tiles++;
      const d = out[session.outputNames[0]].data as Float32Array;
      return xyz ? transposePatch(d, [px, py, pz], d.length / (px * py * pz), false) : d;
    },
    { bodyThreshold, stepFraction: 1 - (meta.overlap ?? 0.2), topkOutput: meta.output?.kind === "topk" ? meta.output.k : undefined },
  );
  return { grid, labels, tiles, seconds: (performance.now() - t0) / 1000 };
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const sd = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
};

it("ctseg benchmark", async () => {
  if (!DATA) throw new Error("DATA (reference data folder) not set – see tools/ctseg-benchmark/README.md");
  ort.env.wasm.numThreads = Math.max(1, Math.min(8, cpus().length));
  mkdirSync(OUT, { recursive: true });
  const ds = JSON.parse(readFileSync(join(DATA, "dataset.json"), "utf8"));
  const refLabels: Record<string, string> = Object.fromEntries(Object.entries(ds.labels as Record<string, string>).filter(([, v]) => !/\//.test(v)));
  const labelDir = ["labelsVa", "labelsTr", "labels"].map((d) => join(DATA, d)).find(existsSync)!;
  const imageDir = labelDir.replace(/labels(\w*)$/, "images$1");
  const cases = readdirSync(labelDir).filter((f) => /\.nii(\.gz)?$/.test(f) && existsSync(join(imageDir, f))).sort().slice(0, N);
  const models: Record<string, Model> = {};
  for (const m of MODELS) models[m] = await loadModel(m);

  const rows: string[] = ["case,model,structure,dice,hd95_mm,nsd_2mm,ref_ml,pred_ml,volume_error_pct"];
  const runs: { case: string; model: string; seconds: number; tiles: number }[] = [];
  const scores: Record<string, Record<string, StructureScore[]>> = {};
  for (const c of cases) {
    const ct = nii(join(imageDir, c));
    const ref = nii(join(labelDir, c));
    const voxMl = (ref.geometry.spacing[0] * ref.geometry.spacing[1] * ref.geometry.spacing[2]) / 1000;
    for (const m of MODELS) {
      const r = await segment(ct, models[m]);
      runs.push({ case: c, model: m, seconds: r.seconds, tiles: r.tiles });
      // Prediction onto the reference grid (nearest neighbour).
      const pred = resampleInto({ ...r.grid, data: r.labels }, worldToVoxelTransform(r.grid.geometry), ref, "nearest");
      const sc = compareLabelMaps(pred, models[m].meta.labels, ref.data, refLabels, {
        dims: [ref.nx, ref.ny, ref.nz],
        spacing: ref.geometry.spacing as [number, number, number],
        surface: true,
        tolerance: 2,
      });
      for (const s of sc) {
        ((scores[m] ??= {})[s.name] ??= []).push(s);
        rows.push([c, m, s.name, s.dice.toFixed(4), s.hd95!.toFixed(2), s.nsd!.toFixed(4), (s.refVoxels * voxMl).toFixed(1), (s.predVoxels * voxMl).toFixed(1), ((100 * (s.predVoxels - s.refVoxels)) / s.refVoxels).toFixed(1)].join(","));
      }
      console.log(`${c} ${m}: ${r.seconds.toFixed(0)} s, ${r.tiles} tiles, mean Dice ${mean(sc.map((s) => s.dice)).toFixed(3)} (${sc.length} structures)`);
      writeFileSync(join(OUT, "results.csv"), rows.join("\n") + "\n");
    }
  }

  // Report: mean ± SD per structure and model, overall means, runtime.
  const structures = [...new Set(Object.values(scores).flatMap((s) => Object.keys(s)))].sort();
  const fmt = (v: number[], d = 3) => (v.length ? `${mean(v).toFixed(d)} ± ${sd(v).toFixed(d)}` : "–");
  const md: string[] = [
    `# CT segmentation benchmark`,
    "",
    `Reference: ${ds.name ?? "dataset"} (${labelDir.split("/").pop()}), ${cases.length} cases: ${cases.map((c) => c.replace(/\.nii(\.gz)?$/, "")).join(", ")}.`,
    `Pipeline of Recon Studio (${RUNTIME}, ${ort.env.wasm.numThreads} threads); predictions resampled (nearest) to the reference grid.`,
    "Metrics per structure: Dice, HD95 (mm), NSD (2 mm tolerance), volume error; mean ± SD over the cases.",
    "",
    "## Overview",
    "",
    "| Model | Size (MB) | Runtime per case (s) | Mean Dice | Mean NSD | Median HD95 (mm) |",
    "|---|---|---|---|---|---|",
  ];
  for (const m of MODELS) {
    const all = Object.values(scores[m] ?? {}).flat();
    const hd = all.map((s) => s.hd95!).filter(Number.isFinite).sort((a, b) => a - b);
    md.push(`| ${models[m].meta.name ?? m} | ${models[m].mb.toFixed(0)} | ${fmt(runs.filter((r) => r.model === m).map((r) => r.seconds), 0)} | ${fmt(all.map((s) => s.dice))} | ${fmt(all.map((s) => s.nsd!))} | ${hd.length ? hd[Math.floor(hd.length / 2)].toFixed(1) : "–"} |`);
  }
  md.push("", "## Dice per structure", "", `| Structure | ${MODELS.join(" | ")} |`, `|---|${MODELS.map(() => "---").join("|")}|`);
  for (const s of structures) md.push(`| ${s} | ${MODELS.map((m) => fmt((scores[m]?.[s] ?? []).map((x) => x.dice))).join(" | ")} |`);
  md.push("", "## NSD (2 mm) per structure", "", `| Structure | ${MODELS.join(" | ")} |`, `|---|${MODELS.map(() => "---").join("|")}|`);
  for (const s of structures) md.push(`| ${s} | ${MODELS.map((m) => fmt((scores[m]?.[s] ?? []).map((x) => x.nsd!))).join(" | ")} |`);
  md.push("", "## HD95 (mm) per structure", "", `| Structure | ${MODELS.join(" | ")} |`, `|---|${MODELS.map(() => "---").join("|")}|`);
  for (const s of structures) md.push(`| ${s} | ${MODELS.map((m) => fmt((scores[m]?.[s] ?? []).map((x) => x.hd95!).filter(Number.isFinite), 1)).join(" | ")} |`);
  writeFileSync(join(OUT, "report.md"), md.join("\n") + "\n");
});
