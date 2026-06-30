import { reconstructSliceRange } from "../recon/volume";
import type { ReconstructRequestMessage, WorkerResponseMessage } from "./types";

function post(message: WorkerResponseMessage, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(message, transfer);
}

self.onmessage = (event: MessageEvent<ReconstructRequestMessage>) => {
  const { sino, zOffset, params } = event.data;
  try {
    const totalSlices = sino.rows;
    const data = reconstructSliceRange(sino, params, 0, sino.rows, (zIndexInRange) => {
      post({ type: "progress", zOffset, doneSlices: zIndexInRange + 1, totalSlices });
    });
    post({ type: "result", zOffset, rows: sino.rows, cols: sino.cols, data }, [data.buffer]);
  } catch (e) {
    post({ type: "error", zOffset, message: e instanceof Error ? e.message : String(e) });
  }
};
