import type { Placed } from "./dose";
import type { DosimetryWorkerMessage, PlainPlaced, VoxelDoseJob } from "../workers/dosimetry.worker";

import { withLang } from "../i18n/lang";
import { t } from "../i18n";
export interface VoxelDoseRun {
  promise: Promise<{ dose: Float32Array; led?: Float32Array }>;
  cancel: () => void;
}

export const plain = (p: Placed): PlainPlaced => ({ data: p.volume.data, nx: p.volume.nx, ny: p.volume.ny, nz: p.volume.nz, geometry: p.volume.geometry, matrix: p.matrix });

/** Voxel TIA and dose map in a worker (the page stays responsive); `led` = local-deposition map when a kernel is used. */
export function runVoxelDose(job: Omit<VoxelDoseJob, "type">, onProgress: (stage: string, fraction: number) => void): VoxelDoseRun {
  const worker = withLang(new Worker(new URL("../workers/dosimetry.worker.ts", import.meta.url), { type: "module" }));
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<{ dose: Float32Array; led?: Float32Array }>((resolve, rej) => {
    reject = rej;
    worker.onmessage = (ev: MessageEvent<DosimetryWorkerMessage>) => {
      const m = ev.data;
      if (m.type === "progress") onProgress(m.stage, m.fraction);
      else {
        worker.terminate();
        if (m.type === "result") resolve({ dose: m.dose, led: m.led });
        else rej(new Error(m.error));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      rej(new Error(e.message || t("Fehler im Dosimetrie-Worker")));
    };
    worker.postMessage({ type: "voxelDose", ...job } satisfies VoxelDoseJob);
  });
  return {
    promise,
    cancel: () => {
      worker.terminate();
      reject(new DOMException("Abgebrochen", "AbortError"));
    },
  };
}
