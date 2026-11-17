import type { Volume3D } from "../viewer/volume";
import type { TumorJob } from "../workers/tumor.worker";
import { type SegmentOptions, type TumorSegmentation, segmentLesions } from "./segment";

/** Lesion segmentation in a worker (falls back to synchronous execution). */
export function runTumorSegmentation(volume: Volume3D, options: SegmentOptions): Promise<TumorSegmentation> {
  if (typeof Worker === "undefined") return Promise.resolve().then(() => segmentLesions(volume, options));
  const worker = new Worker(new URL("../workers/tumor.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ type: string; result?: TumorSegmentation; error?: string }>) => {
      worker.terminate();
      if (e.data.type === "result" && e.data.result) resolve(e.data.result);
      else reject(new Error(e.data.error ?? "Segmentierung fehlgeschlagen."));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "Segmentierung fehlgeschlagen."));
    };
    const job: TumorJob = { data: volume.data, dims: [volume.nx, volume.ny, volume.nz], geometry: volume.geometry, options };
    worker.postMessage(job);
  });
}
