import type { ReconParams } from "../recon/volume";
import { sliceSinogramRows, type Sinogram } from "../recon/sinogram";
import type { ReconstructRequestMessage, WorkerResponseMessage } from "./types";

export interface ReconstructedVolumeData {
  data: Float32Array;
  rows: number;
  cols: number;
}

const MAX_WORKERS = 8;

function makeWorker(): Worker {
  return new Worker(new URL("./reconstruction.worker.ts", import.meta.url), { type: "module" });
}

/**
 * Reconstructs the full volume by splitting axial slices across a small pool of workers.
 * Resolves with a flat [rows, cols, cols] Float32Array volume (slice-major).
 */
export function reconstructVolume(
  sino: Sinogram,
  params: ReconParams,
  onProgress?: (fractionDone: number) => void,
  signal?: AbortSignal,
): Promise<ReconstructedVolumeData> {
  const { rows, cols } = sino;
  const concurrency = Math.max(1, Math.min(MAX_WORKERS, navigator.hardwareConcurrency || 4, rows));
  const chunkSize = Math.ceil(rows / concurrency);
  const chunks: { zStart: number; zEnd: number }[] = [];
  for (let z = 0; z < rows; z += chunkSize) {
    chunks.push({ zStart: z, zEnd: Math.min(z + chunkSize, rows) });
  }

  return new Promise((resolve, reject) => {
    const volume = new Float32Array(rows * cols * cols);
    const sliceSize = cols * cols;
    const doneSlicesByChunk = new Array(chunks.length).fill(0);
    const totalSlicesByChunk = chunks.map((c) => c.zEnd - c.zStart);
    let completedChunks = 0;
    const workers: Worker[] = [];

    const cleanup = () => {
      for (const w of workers) w.terminate();
    };

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      });
    }

    const reportProgress = () => {
      if (!onProgress) return;
      const totalDone = doneSlicesByChunk.reduce((a, b) => a + b, 0);
      onProgress(totalDone / rows);
    };

    chunks.forEach((chunk, chunkIndex) => {
      const worker = makeWorker();
      workers.push(worker);
      const chunkSino = sliceSinogramRows(sino, chunk.zStart, chunk.zEnd);

      worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
        const msg = event.data;
        if (msg.type === "progress") {
          doneSlicesByChunk[chunkIndex] = msg.doneSlices;
          reportProgress();
        } else if (msg.type === "result") {
          volume.set(msg.data, chunk.zStart * sliceSize);
          doneSlicesByChunk[chunkIndex] = totalSlicesByChunk[chunkIndex];
          reportProgress();
          worker.terminate();
          completedChunks++;
          if (completedChunks === chunks.length) {
            resolve({ data: volume, rows, cols });
          }
        } else if (msg.type === "error") {
          cleanup();
          reject(new Error(msg.message));
        }
      };
      worker.onerror = (ev) => {
        cleanup();
        reject(new Error(`Worker-Fehler: ${ev.message}`));
      };

      const request: ReconstructRequestMessage = { type: "reconstruct", sino: chunkSino, zOffset: chunk.zStart, params };
      worker.postMessage(request, [chunkSino.data.buffer, chunkSino.anglesDeg.buffer]);
    });
  });
}
