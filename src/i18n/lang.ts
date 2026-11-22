/**
 * Language of the app (German source texts, English translation): module state so that components, pure
 * functions, CSV and reports can all use `t()`. Stored per browser; first visit follows the browser language.
 */

export type Lang = "de" | "en";

const KEY = "recon-studio-lang";

function initial(): Lang {
  // Web workers get the language of the app in their name ("lang:en"), see workerOptions().
  const wname = typeof window === "undefined" && typeof self !== "undefined" ? (self as { name?: string }).name : undefined;
  if (wname?.startsWith("lang:")) return wname.slice(5) === "en" ? "en" : "de";
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

/** Options for `new Worker(…)`: module type and the current language (read by the worker's copy of this module). */
export const workerOptions = (): WorkerOptions => ({ type: "module", name: `lang:${current}` });
