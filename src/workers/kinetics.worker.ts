import type { VolumeGeometry } from "../core/geometry";
import type { Mat4 } from "../core/transform";
import { framesAtPoints, motionCorrect } from "../kinetics/motion";
import { patlakMaps, patlakSetup } from "../kinetics/patlak";
import { srtmMaps, srtmSetup } from "../kinetics/srtm";

interface Grid {
  nx: number;
  ny: number;
  nz: number;
  geometry: VolumeGeometry;
}

export type KineticsJob =
  | { type: "motion"; frames: Float32Array[]; grid: Grid; startSec: number[]; durationSec: number[]; fromSec: number; referenceFrame?: number }
  | { type: "toTemplate"; frames: Float32Array[]; grid: Grid; toSubject: Mat4; points: Float32Array }
  | {
      type: "maps";
      model: "patlak" | "srtm";
      frames: Float32Array[];
      cref: number[];
      /** Minutes. */
      start: number[];
      duration: number[];
      tStarMin: number;
      mask: Uint8Array;
    };

let stop = false;

self.onmessage = (event: MessageEvent<KineticsJob | { type: "stop" }>) => {
  const post = (m: unknown, t?: Transferable[]) => (self as unknown as Worker).postMessage(m, t ?? []);
  const msg = event.data;
  if (msg.type === "stop") {
    stop = true;
    return;
  }
  const progress = (done: number, total: number) => post({ type: "progress", done, total });
  try {
    if (msg.type === "motion") {
      const r = motionCorrect(msg.frames, msg.grid, msg.startSec, msg.durationSec, msg.fromSec, progress, () => stop, msg.referenceFrame);
      post({ type: "result", frames: r.frames, motion: r.motion }, r.frames.map((f) => f.buffer));
    } else if (msg.type === "toTemplate") {
      const frames = framesAtPoints(msg.frames, msg.grid, msg.toSubject, msg.points, progress);
      post({ type: "result", frames }, frames.map((f) => f.buffer));
    } else {
      const timing = { start: msg.start, duration: msg.duration };
      if (msg.model === "patlak") {
        const m = patlakMaps(msg.frames, patlakSetup(msg.cref, timing, msg.tStarMin), msg.mask);
        post({ type: "result", maps: { ki: m.ki, intercept: m.intercept, r2: m.r2 } }, [m.ki.buffer, m.intercept.buffer, m.r2.buffer]);
      } else {
        const m = srtmMaps(msg.frames, srtmSetup(msg.cref, timing), msg.mask, (f) => progress(Math.round(f * 100), 100));
        post({ type: "result", maps: { bp: m.bp, r1: m.r1, k2: m.k2, k2a: m.k2a, r2: m.r2 } }, [m.bp.buffer, m.r1.buffer, m.k2.buffer, m.k2a.buffer, m.r2.buffer]);
      }
    }
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e), abort: e instanceof DOMException && e.name === "AbortError" });
  }
};
