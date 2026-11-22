import type { Vec3 } from "../core/geometry";
import { resampleVolume } from "../edit/geometryOps";
import type { Volume3D } from "../viewer/volume";
import type { RegistrationJob } from "../workers/registration.worker";
import { type CoregImage, type CoregOptions, type CoregProgress, type CoregResult, coregister } from "./coregister";

import { withLang } from "../i18n/lang";
import { t } from "../i18n";
export interface RegistrationRun {
  promise: Promise<CoregResult>;
  /** Stops the computation (the promise rejects with an AbortError). */
  cancel: () => void;
}

export function toCoregImage(v: Volume3D): CoregImage {
  return { data: v.data, dims: [v.nx, v.ny, v.nz], geometry: v.geometry };
}

/** Voxel limit of a prepared image (≈ 100 MB as Float32). */
export const MAX_COREG_VOXELS = 24_000_000;

/**
 * Working copy for the registration: downsampled to the finest resolution the levels use (half the finest sampling
 * distance) and, for very large volumes, further until it fits `maxVoxels`. The registration never reads finer data,
 * so the result is the same while two full-resolution CTs no longer have to be copied into the worker.
 * Always returns a new array (it can be transferred to the worker).
 */
export function prepareCoregImage(v: Volume3D, levels: number[], maxVoxels = MAX_COREG_VOXELS): CoregImage {
  const finest = Math.min(...levels);
  const g = v.geometry;
  let target = g.spacing.map((s) => Math.max(s, finest / 2)) as Vec3;
  const count = (sp: Vec3) => [v.nx, v.ny, v.nz].reduce((n, d, a) => n * Math.max(1, Math.round((d * g.spacing[a]) / sp[a])), 1);
  while (count(target) > maxVoxels) target = target.map((s) => s * 1.15) as Vec3;
  const down = target.some((s, a) => s > g.spacing[a] * 1.05) ? resampleVolume(v, target) : null;
  const src = down ?? v;
  return { data: down ? down.data : Float32Array.from(v.data), dims: [src.nx, src.ny, src.nz], geometry: src.geometry };
}

/**
 * Runs a coregistration in a dedicated worker (one per run, so cancelling simply terminates it).
 * Falls back to synchronous execution where workers are unavailable.
 */
export function runCoregistration(fixed: Volume3D, moving: Volume3D, options: CoregOptions, onProgress?: (p: CoregProgress) => void): RegistrationRun {
  // A fixed-image mask is defined on the full fixed grid: keep that image as it is.
  const prepFixed = () => (options.fixedMask ? toCoregImage(fixed) : prepareCoregImage(fixed, options.levels));
  if (typeof Worker === "undefined") {
    return { promise: Promise.resolve().then(() => coregister(prepFixed(), prepareCoregImage(moving, options.levels), options, onProgress)), cancel: () => {} };
  }
  const worker = withLang(new Worker(new URL("../workers/registration.worker.ts", import.meta.url), { type: "module" }));
  let rejectFn: (e: unknown) => void = () => {};
  const promise = new Promise<CoregResult>((resolve, reject) => {
    rejectFn = reject;
    worker.onmessage = (e: MessageEvent<{ type: string; progress?: CoregProgress; result?: CoregResult; error?: string }>) => {
      const m = e.data;
      if (m.type === "progress" && m.progress) onProgress?.(m.progress);
      else if (m.type === "result" && m.result) {
        worker.terminate();
        resolve(m.result);
      } else if (m.type === "error") {
        worker.terminate();
        reject(new Error(m.error));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || t("Registrierung fehlgeschlagen.")));
    };
  });
  const job: RegistrationJob = { fixed: prepFixed(), moving: prepareCoregImage(moving, options.levels), options };
  // Prepared images are fresh arrays: hand them over instead of copying (the original data stay untouched).
  const transfer = [job.moving.data.buffer, ...(options.fixedMask ? [] : [job.fixed.data.buffer])] as ArrayBuffer[];
  worker.postMessage(job, transfer);
  return {
    promise,
    cancel: () => {
      worker.terminate();
      rejectFn(new DOMException(t("Registrierung abgebrochen."), "AbortError"));
    },
  };
}
