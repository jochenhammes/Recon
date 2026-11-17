import type { WorldToVoxel } from "../core/geometry";
import { type Interpolation, type TargetGrid, resampleInto } from "../resample/resample";
import type { VoxelGrid } from "../viewer/types";

export interface ResampleJob {
  source: { nx: number; ny: number; nz: number; data: Float32Array; geometry: VoxelGrid["geometry"] };
  w2v: WorldToVoxel;
  target: TargetGrid;
  method: Interpolation;
}

self.onmessage = (event: MessageEvent<ResampleJob>) => {
  const { source, w2v, target, method } = event.data;
  const post = (m: unknown, t?: Transferable[]) => (self as unknown as Worker).postMessage(m, t ?? []);
  try {
    let last = 0;
    const data = resampleInto(source, w2v, target, method, (f) => {
      if (f - last >= 0.02) {
        last = f;
        post({ type: "progress", fraction: f });
      }
    });
    post({ type: "result", data }, [data.buffer]);
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
