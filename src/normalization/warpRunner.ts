import type { WarpJob } from "../workers/warp.worker";
import { type WarpInput, type WarpOptions, type WarpProgress, type WarpResult, estimateWarp } from "./warp";

import { workerOptions } from "../i18n/lang";
import { t } from "../i18n";
export interface WarpRun {
  promise: Promise<WarpResult>;
  /** Stops the computation (the promise rejects with an AbortError). */
  cancel: () => void;
}

/** Runs the nonlinear warp estimation in a dedicated worker (falls back to synchronous execution). */
export function runWarp(input: WarpInput, options: WarpOptions, onProgress?: (p: WarpProgress) => void): WarpRun {
  if (typeof Worker === "undefined") {
    return { promise: Promise.resolve().then(() => estimateWarp(input, options, onProgress)), cancel: () => {} };
  }
  const worker = new Worker(new URL("../workers/warp.worker.ts", import.meta.url), workerOptions());
  let rejectFn: (e: unknown) => void = () => {};
  const promise = new Promise<WarpResult>((resolve, reject) => {
    rejectFn = reject;
    worker.onmessage = (e: MessageEvent<{ type: string; progress?: WarpProgress; result?: WarpResult; error?: string }>) => {
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
      reject(new Error(e.message || t("Nichtlineare Normalisierung fehlgeschlagen.")));
    };
  });
  const job: WarpJob = { input, options };
  worker.postMessage(job);
  return {
    promise,
    cancel: () => {
      worker.terminate();
      rejectFn(new DOMException(t("Normalisierung abgebrochen."), "AbortError"));
    },
  };
}
