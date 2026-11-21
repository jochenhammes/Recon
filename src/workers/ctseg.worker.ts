import * as ort from "onnxruntime-web";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
// The Emscripten loader as a separate file: multi-threaded WebAssembly starts its threads from it
// (with cross-origin isolation); bundled into this worker, the threads would start the worker itself.
import mjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url";
import type { Vec3 } from "../core/geometry";
import { slidingWindow } from "../segmentation/infer";
import { transposePatch } from "../segmentation/preprocess";

/** "auto": WebGPU if available (except Firefox, where WebGPU with ONNX Runtime is not yet reliable), else CPU. */
export type CtSegBackend = "auto" | "webgpu" | "wasm";

export interface CtSegJob {
  model: ArrayBuffer;
  data: Float32Array;
  dims: Vec3;
  patch: [number, number, number];
  classes: number;
  bodyThreshold: number;
  /** Model output: top-k classes with probabilities instead of logits. */
  topkOutput?: number;
  /** Array order the network expects ("xyz": MONAI, z fastest); patches are transposed before/after the run. */
  axisOrder?: "zyx" | "xyz";
  /** Sliding-window step as a fraction of the patch. */
  stepFraction?: number;
  backend: CtSegBackend;
  /** Shown with the progress (e.g. why the CPU is used). */
  note?: string;
}

/** Minimal view of the WebGPU device (no WebGPU type package needed). */
interface GpuDeviceLike {
  addEventListener(type: "uncapturederror", cb: (e: { error?: { message?: string } }) => void): void;
  lost: Promise<{ message?: string; reason?: string }>;
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
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
    // Only touch the GPU when it may be used: after a GPU crash, even requestAdapter() can hang.
    const hasGpu =
      msg.backend !== "wasm" &&
      "gpu" in navigator &&
      !!(await Promise.race([
        (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu.requestAdapter().catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 10000)),
      ]));
    const firefox = /firefox/i.test(navigator.userAgent);
    const [pz, py, px] = msg.patch;
    let note = msg.note ?? "";

    const run = async (backend: "webgpu" | "wasm") => {
      const label = backend === "webgpu" ? "WebGPU" : `CPU${ort.env.wasm.numThreads === 1 ? ", 1 Thread" : `, ${ort.env.wasm.numThreads} Threads`}`;
      post({ type: "progress", progress: { done: 0, total: 1, stage: `Modell wird initialisiert (${label})`, backend, note } });
      const session = await ort.InferenceSession.create(new Uint8Array(msg.model), {
        executionProviders: backend === "webgpu" ? ["webgpu", "wasm"] : ["wasm"],
        graphOptimizationLevel: "all",
      });
      // WebGPU errors (e.g. "Mapping WebGPU buffer failed", device lost) can leave a run pending forever:
      // watch the device and abort the tile as soon as one occurs.
      let gpuError: string | null = null;
      if (backend === "webgpu") {
        try {
          const dev = (await ort.env.webgpu.device) as unknown as GpuDeviceLike;
          dev.addEventListener("uncapturederror", (e) => (gpuError ??= e.error?.message || "WebGPU-Fehler"));
          void dev.lost.then((i) => (gpuError ??= `WebGPU-Gerät verloren${i.message ? ` (${i.message})` : ""}`));
        } catch {
          /* device not accessible: the main-thread watchdog still catches hangs */
        }
      }
      const guard = <T,>(p: Promise<T>): Promise<T> =>
        backend !== "webgpu"
          ? p
          : new Promise<T>((resolve, reject) => {
              const t = setInterval(() => {
                if (gpuError) {
                  clearInterval(t);
                  reject(new Error(gpuError));
                }
              }, 200);
              p.then(
                (v) => (clearInterval(t), resolve(v)),
                (e) => (clearInterval(t), reject(e)),
              );
            });
      let ok = false;
      try {
        const labels = await slidingWindow(
          msg.data,
          msg.dims,
          msg.patch,
          msg.classes,
          async (input) => {
            const xyz = msg.axisOrder === "xyz";
            const tensor = xyz
              ? new ort.Tensor("float32", transposePatch(input, [px, py, pz], 1, true), [1, 1, px, py, pz])
              : new ort.Tensor("float32", input, [1, 1, pz, py, px]);
            const out = await guard(session.run({ [session.inputNames[0]]: tensor }));
            const t = out[session.outputNames[0]];
            const data = (await guard(t.getData())) as Float32Array;
            t.dispose?.();
            if (gpuError) throw new Error(gpuError);
            return xyz ? transposePatch(data, [px, py, pz], data.length / (px * py * pz), false) : data;
          },
          {
            bodyThreshold: msg.bodyThreshold,
            topkOutput: msg.topkOutput,
            stepFraction: msg.stepFraction,
            onProgress: (p) => post({ type: "progress", progress: { ...p, stage: `Inferenz (${label})`, backend, note } }),
            shouldStop: () => stop,
          },
        );
        ok = true;
        return labels;
      } finally {
        // After a WebGPU failure, releasing may itself hang: do not wait for it.
        const rel = session.release().catch(() => undefined);
        if (ok) await rel;
      }
    };

    let backend: "webgpu" | "wasm";
    if (msg.backend === "wasm") backend = "wasm";
    else if (!hasGpu) {
      backend = "wasm";
      if (msg.backend === "webgpu") note = "WebGPU in diesem Browser nicht verfügbar – CPU verwendet";
    } else backend = msg.backend === "auto" && firefox ? "wasm" : "webgpu";

    let labels: Uint8Array;
    try {
      labels = await run(backend);
    } catch (e) {
      if (backend !== "webgpu" || (e instanceof DOMException && e.name === "AbortError")) throw e;
      // A WebGPU problem must not end the segmentation: continue on the CPU.
      note = `WebGPU-Fehler (${e instanceof Error ? e.message.slice(0, 120) : String(e)}) – weiter auf der CPU`;
      backend = "wasm";
      labels = await run(backend);
    }
    post({ type: "result", labels, backend, note }, [labels.buffer]);
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e), abort: e instanceof DOMException && e.name === "AbortError" });
  }
};
