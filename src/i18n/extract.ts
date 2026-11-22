/**
 * Finds all translation keys in source text: t("…"), tk("…"), tn(n, "…", "…"), <T k="…">. Node-side helper for the
 * completeness test and scripts/i18n-check.mjs. Only plain literals count (no ${…} in template strings).
 */
const LIT = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\`(?:[^\`\\$]|\\.|\$(?!\{))*\`)`;
const CALL = new RegExp(String.raw`(?<![\w.$])(t|tk)\(\s*` + LIT, "g");
const PLURAL = new RegExp(String.raw`(?<![\w.$])tn\(\s*[^,]+?,\s*` + LIT + String.raw`\s*,\s*` + LIT, "g");
const COMP = new RegExp(String.raw`<T\s+k=` + LIT, "g");

export function unquote(lit: string): string {
  const q = lit[0];
  const body = lit.slice(1, -1);
  if (q === '"') return JSON.parse(lit) as string;
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|.)/g, (_, e: string) => {
    if (e[0] === "u") return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ""), 16));
    return ({ n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"', "`": "`", $: "$" } as Record<string, string>)[e] ?? e;
  });
}

export function extractKeys(source: string): string[] {
  const keys: string[] = [];
  for (const m of source.matchAll(CALL)) keys.push(unquote(m[2]));
  for (const m of source.matchAll(PLURAL)) keys.push(unquote(m[1]), unquote(m[2]));
  for (const m of source.matchAll(COMP)) keys.push(unquote(m[1]));
  return keys;
}

export const placeholders = (s: string): string[] => [...s.matchAll(/\{(\/?\w+)\}/g)].map((m) => m[1]).sort();
