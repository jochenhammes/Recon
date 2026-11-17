import { worldToVoxelTransform } from "../core/geometry";
import type { TargetGrid } from "../resample/resample";
import { runResample } from "../resample/runner";
import type { Volume3D } from "../viewer/volume";
import type { CtSegJob } from "../workers/ctseg.worker";
import type { SegmentProgress } from "./infer";
import { type ModelMeta, rasGrid } from "./preprocess";

export const MODEL_BASE = `${import.meta.env.BASE_URL}models/totalseg-total-3mm/`;
const CACHE = "recon-studio-models-v1";

export async function loadModelMeta(): Promise<ModelMeta> {
  const r = await fetch(`${MODEL_BASE}model.json`);
  if (!r.ok) throw new Error(`Modellbeschreibung nicht ladbar (${r.status}).`);
  return r.json();
}

/** Model bytes from the browser cache, or downloaded once (with progress) and cached. */
export async function loadModelBytes(meta: ModelMeta, onProgress?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
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
      if (!net.ok || !net.body) throw new Error(`Modell nicht ladbar (${net.status}).`);
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
  if (out.length !== meta.bytes) throw new Error("Modelldatei unvollständig.");
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

/** Full pipeline: model download/cache → RAS 3 mm resampling → normalization → sliding window in a worker. */
export function runCtSegmentation(ct: Volume3D, backend: "auto" | "wasm", onProgress: (p: SegmentProgress) => void): CtSegRun {
  let worker: Worker | null = null;
  let cancelled = false;
  let rejectFn: (e: unknown) => void = () => {};
  const promise = new Promise<CtSegResult>((resolve, reject) => {
    rejectFn = reject;
    (async () => {
      const meta = await loadModelMeta();
      const model = await loadModelBytes(meta, (l, t) => onProgress({ done: l, total: t, stage: `Modell laden (${(l / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB)` }));
      if (cancelled) return;
      const grid = rasGrid(ct, meta.spacing[0]);
      onProgress({ done: 0, total: 1, stage: "CT auf 3 mm umrechnen" });
      const data = await runResample(ct, worldToVoxelTransform(ct.geometry), grid, "linear", (f) => onProgress({ done: f, total: 1, stage: "CT auf 3 mm umrechnen" }));
      const [lo, hi] = meta.normalization.clip;
      const { mean, std } = meta.normalization;
      for (let i = 0; i < data.length; i++) {
        const x = Number.isFinite(data[i]) ? data[i] : lo;
        data[i] = ((x < lo ? lo : x > hi ? hi : x) - mean) / std;
      }
      if (cancelled) return;
      worker = new Worker(new URL("../workers/ctseg.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<{ type: string; progress?: SegmentProgress; labels?: Uint8Array; backend?: string; note?: string; error?: string; abort?: boolean }>) => {
        const m = e.data;
        if (m.type === "progress" && m.progress) onProgress(m.progress);
        else if (m.type === "result" && m.labels) {
          worker?.terminate();
          resolve({ labels: m.labels, grid, backend: m.backend ?? "", note: m.note || undefined, meta });
        } else if (m.type === "error") {
          worker?.terminate();
          reject(m.abort ? new DOMException("Segmentierung abgebrochen.", "AbortError") : new Error(m.error));
        }
      };
      worker.onerror = (e) => {
        worker?.terminate();
        reject(new Error(e.message || "Segmentierung fehlgeschlagen."));
      };
      const job: CtSegJob = {
        model,
        data,
        dims: [grid.nx, grid.ny, grid.nz],
        patch: meta.patchSize,
        classes: Object.keys(meta.labels).length,
        bodyThreshold: (-500 - mean) / std,
        backend,
      };
      worker.postMessage(job, [model, data.buffer]);
    })().catch(reject);
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      worker?.postMessage({ type: "stop" });
      setTimeout(() => worker?.terminate(), 2000);
      rejectFn(new DOMException("Segmentierung abgebrochen.", "AbortError"));
    },
  };
}
