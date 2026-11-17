import { type WarpInput, type WarpOptions, estimateWarp } from "../normalization/warp";

export interface WarpJob {
  input: WarpInput;
  options: WarpOptions;
}

self.onmessage = (event: MessageEvent<WarpJob>) => {
  const { input, options } = event.data;
  const post = (m: unknown, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []);
  try {
    const result = estimateWarp(input, options, (p) => post({ type: "progress", progress: p }));
    post({ type: "result", result }, [result.field.buffer]);
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
