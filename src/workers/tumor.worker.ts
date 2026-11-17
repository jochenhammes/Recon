import type { VolumeGeometry } from "../core/geometry";
import { type SegmentOptions, segmentLesions } from "../tumor/segment";
import { Volume3D } from "../viewer/volume";

export interface TumorJob {
  data: Float32Array;
  dims: [number, number, number];
  geometry: VolumeGeometry;
  options: SegmentOptions;
}

self.onmessage = (event: MessageEvent<TumorJob>) => {
  const { data, dims, geometry, options } = event.data;
  const post = (m: unknown, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []);
  try {
    const g = geometry;
    const vol = new Volume3D(data, dims[2], dims[1], dims[0], [g.spacing[2], g.spacing[1], g.spacing[0]], g);
    const result = segmentLesions(vol, options);
    post({ type: "result", result }, [result.labels.buffer]);
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
