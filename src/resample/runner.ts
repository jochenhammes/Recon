import type { WorldToVoxel } from "../core/geometry";
import type { Volume3D } from "../viewer/volume";
import type { ResampleJob } from "../workers/resample.worker";
import { type Interpolation, type TargetGrid, resampleInto } from "./resample";

/** Resamples in a worker (synchronous fallback without workers). */
export function runResample(source: Volume3D, w2v: WorldToVoxel, target: TargetGrid, method: Interpolation, onProgress?: (f: number) => void): Promise<Float32Array> {
  if (typeof Worker === "undefined") return Promise.resolve().then(() => resampleInto(source, w2v, target, method, onProgress));
  const worker = new Worker(new URL("../workers/resample.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ type: string; fraction?: number; data?: Float32Array; error?: string }>) => {
      const m = e.data;
      if (m.type === "progress") onProgress?.(m.fraction ?? 0);
      else if (m.type === "result" && m.data) {
        worker.terminate();
        resolve(m.data);
      } else if (m.type === "error") {
        worker.terminate();
        reject(new Error(m.error));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "Resampling fehlgeschlagen."));
    };
    const job: ResampleJob = { source: { nx: source.nx, ny: source.ny, nz: source.nz, data: source.data, geometry: source.geometry }, w2v, target, method };
    worker.postMessage(job);
  });
}
