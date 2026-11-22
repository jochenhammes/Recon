import { worldToVoxelTransform } from "../core/geometry";
import type { TargetGrid } from "../resample/resample";
import { runResample } from "../resample/runner";
import type { Volume3D } from "../viewer/volume";
import type { CtSegBackend, CtSegJob } from "../workers/ctseg.worker";
import type { SegmentProgress } from "./infer";
import { type ModelMeta, normalizeForModel, rasGrid } from "./preprocess";

import { workerOptions } from "../i18n/lang";
import { tr, tk } from "../i18n";
/** CT segmentation models shipped with the app (ONNX, top-k output). */
export interface CtModelInfo {
  id: string;
  /** Folder under public/models/. */
  dir: string;
  label: string;
  /** Short description for the selection (structures, resolution). */
  info: string;
  license: string;
  /** Use restriction shown in the UI (e.g. non-commercial). */
  restriction?: string;
  sizeMb: number;
  /** Short name used in dataset names. */
  short: string;
  /** Citation stored with the label dataset. */
  attribution: string;
}

export const CT_MODELS: CtModelInfo[] = [
  { id: "totalseg-3mm", dir: "totalseg-total-3mm", label: tk("TotalSegmentator total (3 mm)"), info: tk("117 Strukturen · nnU-Net"), license: "Apache-2.0", sizeMb: 66, short: "TotalSegmentator", attribution: "TotalSegmentator total 3 mm (Wasserthal et al. 2023), Apache-2.0" },
  {
    id: "totalseg-organs-1.5mm",
    dir: "totalseg-organs-1.5mm",
    label: tk("TotalSegmentator Organe (1,5 mm)"),
    info: tk("24 Organe, feines Raster · nnU-Net · für Rumpf-/Bauch-CT, langsam, WebGPU empfohlen"),
    license: "Apache-2.0",
    sizeMb: 125,
    short: tk("TotalSegmentator 1,5 mm"),
    attribution: "TotalSegmentator v2 organs 1.5 mm, Dataset291 (Wasserthal et al. 2023), Apache-2.0",
  },
  {
    id: "moose-organs-1.5mm",
    dir: "moose-organs-1.5mm",
    label: tk("MOOSE Organe (1,5 mm)"),
    info: tk("19 Organe inkl. Gehirn/Schilddrüse · auf PET/CT-CTs trainiert · für Rumpf-/Bauch-CT, langsam"),
    license: "CC BY 4.0",
    sizeMb: 122,
    short: "MOOSE",
    attribution: "MOOSE 3 clin_ct_organs (Shiyam Sundar et al., J Nucl Med 2022; ENHANCE-PET), CC BY 4.0",
  },
];
export const DEFAULT_CT_MODEL = CT_MODELS[0].id;

export const modelBase = (id: string = DEFAULT_CT_MODEL) => `${import.meta.env.BASE_URL}models/${(CT_MODELS.find((m) => m.id === id) ?? CT_MODELS[0]).dir}/`;
/** Base URL of the default model (kept for existing callers). */
export const MODEL_BASE = modelBase();
const CACHE = "recon-studio-models-v1";

export async function loadModelMeta(id: string = DEFAULT_CT_MODEL): Promise<ModelMeta> {
  const MODEL_BASE = modelBase(id);
  const r = await fetch(`${MODEL_BASE}model.json`);
  if (!r.ok) throw new Error(tr("Modellbeschreibung nicht ladbar ({status}).", { status: r.status }));
  return r.json();
}

/** Model bytes from the browser cache, or downloaded once (with progress) and cached. */
export async function loadModelBytes(meta: ModelMeta, onProgress?: (loaded: number, total: number) => void, id: string = DEFAULT_CT_MODEL): Promise<ArrayBuffer> {
  const MODEL_BASE = modelBase(id);
  const cache = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null;
  // Remove older versions of the model (different checksum) from the cache.
  if (cache) {
    const tag = `sha=${meta.sha256.slice(0, 16)}`;
    for (const req of await cache.keys().catch(() => [] as Request[])) if (req.url.includes(MODEL_BASE) && !req.url.includes(tag)) await cache.delete(req).catch(() => false);
  }
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (const part of meta.parts) {
    const url = `${MODEL_BASE}${part}?sha=${meta.sha256.slice(0, 16)}`;
    let res = cache ? await cache.match(url) : undefined;
    if (!res) {
      const net = await fetch(url);
      if (!net.ok || !net.body) throw new Error(tr("Modell nicht ladbar ({status}).", { status: net.status }));
      const reader = net.body.getReader();
      const parts: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        loaded += value.length;
        onProgress?.(loaded, meta.bytes);
      }
      const blob = new Blob(parts as BlobPart[]);
      await cache?.put(url, new Response(blob)).catch(() => undefined);
      chunks.push(new Uint8Array(await blob.arrayBuffer()));
    } else {
      const b = new Uint8Array(await res.arrayBuffer());
      loaded += b.length;
      onProgress?.(loaded, meta.bytes);
      chunks.push(b);
    }
  }
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  if (out.length !== meta.bytes) throw new Error(tr("Modelldatei unvollständig."));
  return out.buffer;
}

export interface CtSegResult {
  labels: Uint8Array;
  /** Model grid in the CT's own patient coordinates. */
  grid: TargetGrid;
  backend: string;
  /** e.g. WebGPU fallback notice. */
  note?: string;
  meta: ModelMeta;
}

export interface CtSegRun {
  promise: Promise<CtSegResult>;
  cancel: () => void;
}

/** Working memory of the segmentation per voxel of the model grid: CT (4 B) + top-k accumulator (4 × 5 B) + labels. */
export const BYTES_PER_VOXEL = 25;
/** Upper limit of the working memory; above it browsers abort with "Array buffer allocation failed". */
export const MAX_SEGMENTATION_BYTES = 1.6e9;

/** Whether the model grid of a CT fits into the browser's memory (with a message naming the alternative if not). */
export function segmentationMemory(grid: { nx: number; ny: number; nz: number }, spacingMm: number): { ok: boolean; bytes: number; message: string } {
  const bytes = grid.nx * grid.ny * grid.nz * BYTES_PER_VOXEL;
  const ok = bytes <= MAX_SEGMENTATION_BYTES;
  const lengthCm = Math.round((grid.nz * spacingMm) / 10);
  return {
    ok,
    bytes,
    message: ok
      ? ""
      : tr("CT zu groß für das {v}-mm-Modell ({lengthCm} cm Länge, ≈ {v2} GB Arbeitsspeicher). ", { v: String(spacingMm).replace(".", ","), lengthCm, v2: (bytes / 1e9).toFixed(1) }) +
        tr("Bitte das 3-mm-Modell verwenden oder das CT auf die Körperregion zuschneiden (Bearbeiten → VOI → Auf VOI zuschneiden)."),
  };
}

/** Watchdog limit for one WebGPU tile: the first includes shader compilation, later ones are ~uniform. */
export function tileTimeLimitSec(done: number, elapsedSec: number): number {
  if (done === 0) return 15 * 60;
  return Math.max(180, 6 * (elapsedSec / done));
}

/** Full pipeline: model download/cache → RAS 3 mm resampling → normalization → sliding window in a worker. */
export function runCtSegmentation(ct: Volume3D, backend: CtSegBackend, onProgress: (p: SegmentProgress) => void, modelId: string = DEFAULT_CT_MODEL): CtSegRun {
  let worker: Worker | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let cancelled = false;
  let rejectFn: (e: unknown) => void = () => {};
  const stopAll = () => {
    if (watchdog) clearInterval(watchdog);
    watchdog = null;
    worker?.terminate();
  };
  const promise = new Promise<CtSegResult>((resolve, reject) => {
    rejectFn = reject;
    (async () => {
      const meta = await loadModelMeta(modelId);
      const model = await loadModelBytes(meta, (l, t) => onProgress({ done: l, total: t, stage: tr("Modell laden ({v} / {v2} MB)", { v: (l / 1e6).toFixed(0), v2: (t / 1e6).toFixed(0) }) }), modelId);
      if (cancelled) return;
      const grid = rasGrid(ct, meta.spacing[0]);
      const check = segmentationMemory(grid, meta.spacing[0]);
      if (!check.ok) throw new Error(check.message);
      const mm = meta.spacing[0].toString().replace(".", ",");
      onProgress({ done: 0, total: 1, stage: tr("CT auf {mm} mm umrechnen", { mm }) });
      const data = await runResample(ct, worldToVoxelTransform(ct.geometry), grid, "linear", (f) => onProgress({ done: f, total: 1, stage: tr("CT auf {mm} mm umrechnen", { mm }) }));
      const bodyThreshold = normalizeForModel(data, meta.normalization);
      if (cancelled) return;

      // Model and data are copied (not transferred) to the worker, so it can be restarted on the CPU.
      const start = (b: CtSegBackend, note?: string) => {
        stopAll();
        let last: SegmentProgress | null = null;
        let lastAt = Date.now();
        worker = new Worker(new URL("../workers/ctseg.worker.ts", import.meta.url), workerOptions());
        worker.onmessage = (e: MessageEvent<{ type: string; progress?: SegmentProgress; labels?: Uint8Array; backend?: string; note?: string; error?: string; abort?: boolean }>) => {
          const m = e.data;
          if (m.type === "progress" && m.progress) {
            lastAt = Date.now();
            last = m.progress;
            onProgress({ ...m.progress, receivedAt: lastAt });
          } else if (m.type === "result" && m.labels) {
            stopAll();
            resolve({ labels: m.labels, grid, backend: m.backend ?? "", note: m.note || undefined, meta });
          } else if (m.type === "error") {
            stopAll();
            reject(m.abort ? new DOMException("Segmentierung abgebrochen.", "AbortError") : new Error(m.error));
          }
        };
        worker.onerror = (e) => {
          stopAll();
          reject(new Error(e.message || "Segmentierung fehlgeschlagen."));
        };
        // A WebGPU tile that never finishes (driver/browser problem without an error): restart on the CPU.
        watchdog = setInterval(() => {
          const p = last as SegmentProgress | null;
          if (!p || p.backend !== "webgpu") return;
          const isInference = !!p.inference;
          const limit = isInference ? tileTimeLimitSec(p.done, p.elapsed ?? 0) : 15 * 60;
          if ((Date.now() - lastAt) / 1000 > limit) {
            const where = isInference ? tr("bei Kachel {v}/{total}", { v: Math.min(p.done + 1, p.total), total: p.total }) : tr("bei der Initialisierung");
            const note = tr("WebGPU reagierte nicht mehr ({where}) – neu gestartet auf der CPU", { where });
            onProgress({ done: 0, total: 1, stage: tr("Neustart auf der CPU"), backend: "wasm", note, receivedAt: Date.now() });
            start("wasm", note);
          }
        }, 5000);
        const job: CtSegJob = {
          model,
          data,
          dims: [grid.nx, grid.ny, grid.nz],
          patch: meta.patchSize,
          classes: Object.keys(meta.labels).length,
          bodyThreshold,
          topkOutput: meta.output?.kind === "topk" ? meta.output.k : undefined,
          axisOrder: meta.axisOrder ?? "zyx",
          stepFraction: 1 - (meta.overlap ?? 0.2),
          backend: b,
          note,
        };
        worker.postMessage(job);
      };
      start(backend);
    })().catch(reject);
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (watchdog) clearInterval(watchdog);
      worker?.postMessage({ type: "stop" });
      const w = worker;
      setTimeout(() => w?.terminate(), 2000);
      rejectFn(new DOMException("Segmentierung abgebrochen.", "AbortError"));
    },
  };
}
