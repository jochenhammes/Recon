import * as ort from "onnxruntime-web";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
import type { Vec3 } from "../core/geometry";
import { slidingWindow } from "../segmentation/infer";

export interface CtSegJob {
  model: ArrayBuffer;
  data: Float32Array;
  dims: Vec3;
  patch: [number, number, number];
  classes: number;
  bodyThreshold: number;
  /** "webgpu" | "wasm" | "auto" */
  backend: string;
}

let stop = false;

self.onmessage = async (event: MessageEvent<CtSegJob | { type: "stop" }>) => {
  const post = (m: unknown, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []);
  const msg = event.data;
  if ("type" in msg) {
    stop = true;
    return;
  }
  try {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl };
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
    const hasGpu = "gpu" in navigator && !!(await (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
    const providers = msg.backend === "wasm" || !hasGpu ? ["wasm"] : ["webgpu", "wasm"];
    post({ type: "progress", progress: { done: 0, total: 1, stage: `Modell wird initialisiert (${providers[0] === "webgpu" ? "WebGPU" : "CPU/WASM"})` } });
    const session = await ort.InferenceSession.create(new Uint8Array(msg.model), { executionProviders: providers, graphOptimizationLevel: "all" });
    const [pz, py, px] = msg.patch;
    const labels = await slidingWindow(
      msg.data,
      msg.dims,
      msg.patch,
      msg.classes,
      async (input) => {
        const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 1, pz, py, px]) });
        const t = out[session.outputNames[0]];
        const data = (await t.getData()) as Float32Array;
        t.dispose?.();
        return data;
      },
      { bodyThreshold: msg.bodyThreshold, onProgress: (p) => post({ type: "progress", progress: { ...p, stage: `Inferenz (${providers[0] === "webgpu" ? "WebGPU" : "CPU"})` } }), shouldStop: () => stop },
    );
    await session.release();
    post({ type: "result", labels, backend: providers[0] }, [labels.buffer]);
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e), abort: e instanceof DOMException && e.name === "AbortError" });
  }
};
