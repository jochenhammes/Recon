import type { Volume3D } from "../viewer/volume";
import type { RegistrationJob } from "../workers/registration.worker";
import { type CoregImage, type CoregOptions, type CoregProgress, type CoregResult, coregister } from "./coregister";

export interface RegistrationRun {
  promise: Promise<CoregResult>;
  /** Stops the computation (the promise rejects with an AbortError). */
  cancel: () => void;
}

export function toCoregImage(v: Volume3D): CoregImage {
  return { data: v.data, dims: [v.nx, v.ny, v.nz], geometry: v.geometry };
}

/**
 * Runs a coregistration in a dedicated worker (one per run, so cancelling simply terminates it).
 * Falls back to synchronous execution where workers are unavailable.
 */
export function runCoregistration(fixed: Volume3D, moving: Volume3D, options: CoregOptions, onProgress?: (p: CoregProgress) => void): RegistrationRun {
  if (typeof Worker === "undefined") {
    return { promise: Promise.resolve().then(() => coregister(toCoregImage(fixed), toCoregImage(moving), options, onProgress)), cancel: () => {} };
  }
  const worker = new Worker(new URL("../workers/registration.worker.ts", import.meta.url), { type: "module" });
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
      reject(new Error(e.message || "Registrierung fehlgeschlagen."));
    };
  });
  const job: RegistrationJob = { fixed: toCoregImage(fixed), moving: toCoregImage(moving), options };
  worker.postMessage(job);
  return {
    promise,
    cancel: () => {
      worker.terminate();
      rejectFn(new DOMException("Registrierung abgebrochen.", "AbortError"));
    },
  };
}
