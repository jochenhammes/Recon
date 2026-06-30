import type { ReconParams } from "../recon/volume";
import type { Sinogram } from "../recon/sinogram";

export interface ReconstructRequestMessage {
  type: "reconstruct";
  /** Sinogram restricted to this worker's axial-row range; `rows` is the chunk size, not the full volume depth. */
  sino: Sinogram;
  /** Offset of this chunk's first row within the full volume (for assembling results on the main thread). */
  zOffset: number;
  params: ReconParams;
}

export type WorkerResponseMessage =
  | { type: "progress"; zOffset: number; doneSlices: number; totalSlices: number }
  | { type: "result"; zOffset: number; rows: number; cols: number; data: Float32Array }
  | { type: "error"; zOffset: number; message: string };
