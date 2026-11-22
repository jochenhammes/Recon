import { getLang } from "./lang";
import { EN } from "./en";

export type Vars = Record<string, string | number | null | undefined>;

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? "") : m)) : s);

/**
 * Translates a German source text (the key) into the current language; placeholders `{name}` are filled from
 * `vars`. Missing translations fall back to German.
 */
export function t(de: string, vars?: Vars): string {
  return fill(getLang() === "en" ? (EN[de] ?? de) : de, vars);
}

/** Singular/plural by `n` (German keys for both forms); `{n}` is available as placeholder. */
export function tn(n: number, deOne: string, deMany: string, vars?: Vars): string {
  return t(n === 1 ? deOne : deMany, { n, ...vars });
}

/** A text in a given language regardless of the current one (e.g. tests, exports with fixed language). */
export function tIn(lang: "de" | "en", de: string, vars?: Vars): string {
  return fill(lang === "en" ? (EN[de] ?? de) : de, vars);
}

/** Marks a German text as translation key without translating it now (for constant tables shown later via `t()`). */
export const tk = (de: string): string => de;

/** Same as `t`, for modules where `t` is a local name (e.g. time). */
export const tr = t;

/** Same as `t`, for modules where `t` and `tr` are local names. */
export const tx = t;

/** The text in both languages (to recognise names created in either language, e.g. "CT-Organe · …"). */
export const tBoth = (de: string, vars?: Vars): string[] => [tIn("de", de, vars), tIn("en", de, vars)];
