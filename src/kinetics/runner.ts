import type { KineticsJob } from "../workers/kinetics.worker";

import { workerOptions } from "../i18n/lang";
import { t } from "../i18n";
export interface KineticsRun<T> {
  promise: Promise<T>;
  cancel: () => void;
}

/** Runs one kinetics job in its own worker (progress as done/total). */
export function runKineticsJob<T>(job: KineticsJob, onProgress?: (done: number, total: number) => void): KineticsRun<T> {
  const worker = new Worker(new URL("../workers/kinetics.worker.ts", import.meta.url), workerOptions());
  let rejectFn: (e: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    rejectFn = reject;
    worker.onmessage = (e: MessageEvent<{ type: string; done?: number; total?: number; error?: string; abort?: boolean } & Record<string, unknown>>) => {
      const m = e.data;
      if (m.type === "progress") onProgress?.(m.done ?? 0, m.total ?? 1);
      else if (m.type === "result") {
        worker.terminate();
        resolve(m as unknown as T);
      } else if (m.type === "error") {
        worker.terminate();
        reject(m.abort ? new DOMException("Abgebrochen.", "AbortError") : new Error(m.error));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || t("Kinetik-Berechnung fehlgeschlagen.")));
    };
    // Frames are copied, not transferred: the dataset keeps its own.
    worker.postMessage(job);
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      rejectFn(new DOMException("Abgebrochen.", "AbortError"));
    },
  };
}
