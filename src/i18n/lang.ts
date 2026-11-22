/**
 * Language of the app (German source texts, English translation): module state so that components, pure
 * functions, CSV and reports can all use `t()`. Stored per browser; first visit follows the browser language.
 */

export type Lang = "de" | "en";

const KEY = "recon-studio-lang";

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "de" || saved === "en") return saved;
  } catch {
    /* storage blocked */
  }
  const nav = typeof navigator !== "undefined" ? (navigator.languages?.[0] ?? navigator.language ?? "") : "";
  return /^de\b/i.test(nav) || nav === "" ? "de" : "en";
}

let current: Lang = initial();
const listeners = new Set<() => void>();

const applyDocument = () => {
  if (typeof document !== "undefined") document.documentElement.lang = current;
};
applyDocument();

export const getLang = (): Lang => current;

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* storage blocked */
  }
  applyDocument();
  for (const f of listeners) f();
}

export function subscribeLang(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Locale for numbers and dates in the UI (CSV keeps the German format on purpose). */
export const locale = (): string => (current === "de" ? "de-DE" : "en-GB");

// Web workers: every message from the app carries the app language (`__lang`, see withLang()); read it before the
// worker's own handler runs (this listener is registered first, at import time).
if (typeof window === "undefined" && typeof self !== "undefined" && typeof (self as { addEventListener?: unknown }).addEventListener === "function") {
  self.addEventListener("message", (e: MessageEvent) => {
    const l = (e.data as { __lang?: unknown } | null)?.__lang;
    if (l === "de" || l === "en") current = l;
  });
}

/** Wraps a worker so that every object message carries the current app language for the worker's `t()`. */
export function withLang<W extends Worker>(w: W): W {
  const post = w.postMessage.bind(w) as (m: unknown, t?: Transferable[] | StructuredSerializeOptions) => void;
  w.postMessage = ((m: unknown, t?: Transferable[] | StructuredSerializeOptions) =>
    post(m && typeof m === "object" && !Array.isArray(m) && !ArrayBuffer.isView(m) && !(m instanceof ArrayBuffer) ? { ...(m as object), __lang: current } : m, t)) as W["postMessage"];
  return w;
}
