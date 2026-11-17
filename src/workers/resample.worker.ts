import type { WorldToVoxel } from "../core/geometry";
import { type Interpolation, type TargetGrid, resampleAtPoints, resampleInto } from "../resample/resample";
import type { VoxelGrid } from "../viewer/types";

export interface ResampleJob {
  source: { nx: number; ny: number; nz: number; data: Float32Array; geometry: VoxelGrid["geometry"] };
  w2v: WorldToVoxel;
  /** Either a target grid … */
  target?: TargetGrid;
  /** … or explicit world positions (xyz interleaved), e.g. a pulled-back deformation. */
  points?: Float32Array;
  method: Interpolation;
}

self.onmessage = (event: MessageEvent<ResampleJob>) => {
  const { source, w2v, target, points, method } = event.data;
  const post = (m: unknown, t?: Transferable[]) => (self as unknown as Worker).postMessage(m, t ?? []);
  try {
    let last = 0;
    const progress = (f: number) => {
      if (f - last >= 0.02) {
        last = f;
        post({ type: "progress", fraction: f });
      }
    };
    const data = points ? resampleAtPoints(source, w2v, points, method, progress) : resampleInto(source, w2v, target!, method, progress);
    post({ type: "result", data }, [data.buffer]);
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
