import { type CoregImage, type CoregOptions, coregister } from "../registration/coregister";

export interface RegistrationJob {
  fixed: CoregImage;
  moving: CoregImage;
  options: CoregOptions;
}

self.onmessage = (event: MessageEvent<RegistrationJob>) => {
  const { fixed, moving, options } = event.data;
  const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
  try {
    const result = coregister(fixed, moving, options, (p) => post({ type: "progress", progress: p }));
    post({ type: "result", result });
  } catch (e) {
    post({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
};
