import type { WorldToVoxel } from "../core/geometry";
import type { Volume3D } from "../viewer/volume";
import type { ResampleJob } from "../workers/resample.worker";
import { type Interpolation, type TargetGrid, resampleAtPoints, resampleInto } from "./resample";

import { workerOptions } from "../i18n/lang";
/** Resamples onto a grid (or at explicit world positions) in a worker; synchronous fallback without workers. */
export function runResample(
  source: Volume3D,
  w2v: WorldToVoxel,
  target: TargetGrid | Float32Array,
  method: Interpolation,
  onProgress?: (f: number) => void,
): Promise<Float32Array> {
  const points = target instanceof Float32Array ? target : undefined;
  const grid = target instanceof Float32Array ? undefined : target;
  if (typeof Worker === "undefined")
    return Promise.resolve().then(() => (points ? resampleAtPoints(source, w2v, points, method, onProgress) : resampleInto(source, w2v, grid!, method, onProgress)));
  const worker = new Worker(new URL("../workers/resample.worker.ts", import.meta.url), workerOptions());
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
    const job: ResampleJob = { source: { nx: source.nx, ny: source.ny, nz: source.nz, data: source.data, geometry: source.geometry }, w2v, target: grid, points, method };
    worker.postMessage(job);
  });
}
