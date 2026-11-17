import type { Vec3 } from "../core/geometry";
import { accumulateTile, accumulateTopKTile, bodyBox, createTopK, extractPatch, gaussianMap, tileStarts, topKLabels } from "./preprocess";

export interface SegmentProgress {
  done: number;
  total: number;
  stage: string;
  /** Seconds since the inference started and estimated remaining seconds (after the first tile). */
  elapsed?: number;
  remaining?: number;
}

/**
 * Sliding-window segmentation (tile step 0.8 of the patch, as TotalSegmentator uses for the "total" model) of a normalized volume (x fastest; array order z, y, x for the model).
 * `runPatch` returns the logits (classes × patch, channel-major). Only the body box (voxels above
 * `bodyThreshold`) is tiled; voxels outside stay background.
 */
export async function slidingWindow(
  data: Float32Array,
  dims: Vec3,
  patch: [number, number, number],
  classes: number,
  runPatch: (input: Float32Array) => Promise<Float32Array>,
  opts: {
    bodyThreshold: number;
    stepFraction?: number;
    /** Model returns [class, p] × k instead of logits. */
    topkOutput?: number;
    onProgress?: (p: SegmentProgress) => void;
    shouldStop?: () => boolean;
  },
): Promise<Uint8Array> {
  // Tile placement exactly as nnU-Net (whole image, centered padding): cropping to the body changes the
  // context of the tiles and with it ambiguous labels (e.g. vertebra numbering). The body box is only
  // used to skip images without any tissue.
  if (!bodyBox(data, dims, opts.bodyThreshold, 0)) return new Uint8Array(data.length);
  const box = { min: [0, 0, 0] as Vec3, max: dims };
  const topk = createTopK(data.length, 4);
  const gauss = gaussianMap(patch);
  const [pz, py, px] = patch;
  const span = (a: number) => box.max[a] - box.min[a];
  // Tiles over the body box; a box smaller than the patch is centered (padding on both sides).
  const starts = (a: number, p: number) => (span(a) <= p ? [box.min[a] - Math.floor((p - span(a)) / 2)] : tileStarts(span(a), p, opts.stepFraction ?? 0.8).map((s) => s + box.min[a]));
  const xs = starts(0, px), ys = starts(1, py), zs = starts(2, pz);
  const total = xs.length * ys.length * zs.length;
  let done = 0;
  const t0 = performance.now();
  const seconds = () => (performance.now() - t0) / 1000;
  for (const z of zs)
    for (const y of ys)
      for (const x of xs) {
        if (opts.shouldStop?.()) throw new DOMException("Segmentierung abgebrochen.", "AbortError");
        const start: Vec3 = [x, y, z];
        // Report before the tile so a slow first tile (shader compilation) is visible.
        opts.onProgress?.({ done, total, stage: "Inferenz", elapsed: seconds(), remaining: done ? (seconds() / done) * (total - done) : undefined });
        const input = extractPatch(data, dims, start, patch, 0);
        const out = await runPatch(input);
        if (opts.topkOutput) accumulateTopKTile(out, opts.topkOutput, gauss, start, patch, dims, topk);
        else accumulateTile(out, classes, gauss, start, patch, dims, topk);
        done++;
        opts.onProgress?.({ done, total, stage: "Inferenz", elapsed: seconds(), remaining: (seconds() / done) * (total - done) });
      }
  return topKLabels(topk, data.length);
}
