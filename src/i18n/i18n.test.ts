import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EN } from "./en";
import { extractKeys, placeholders } from "./extract";
import { setLang } from "./lang";
import { t, tIn, tn } from "./t";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "i18n" || n === "__gen" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("i18n", () => {
  it("translates with placeholders, plural and German fallback", () => {
    setLang("en");
    expect(t("Deutsch")).toBe("German");
    expect(t("unbekannter Text {x}", { x: 3 })).toBe("unbekannter Text 3");
    expect(tIn("de", "Deutsch")).toBe("Deutsch");
    setLang("de");
    expect(t("Deutsch")).toBe("Deutsch");
    expect(tn(1, "{n} Datensatz", "{n} Datensätze")).toBe("1 Datensatz");
    expect(tn(3, "{n} Datensatz", "{n} Datensätze")).toBe("3 Datensätze");
  });

  it("extracts keys from t, tk, tn and <T k>", () => {
    const src = `t("A {x}"); tk('B'); tn(n, "C", "D"); <T k="E {b}f{/b}" />; t(\`G\`); x.t("no"); t(\`H \${y}\`)`;
    expect(extractKeys(src)).toEqual(["A {x}", "B", "G", "C", "D", "E {b}f{/b}"]);
  });

  const keys = new Map<string, string>();
  for (const f of sources(join(__dirname, ".."))) for (const k of extractKeys(readFileSync(f, "utf8"))) if (!keys.has(k)) keys.set(k, f);

  it("every key used in the source has an English translation with the same placeholders", () => {
    const missing = [...keys].filter(([k]) => !(k in EN)).map(([k, f]) => `${f.split("/src/")[1]}: ${k}`);
    expect(missing, `${missing.length} ohne Übersetzung`).toEqual([]);
    const bad = [...keys.keys()].filter((k) => k in EN && placeholders(k).join() !== placeholders(EN[k]).join());
    expect(bad, "Platzhalter verschieden").toEqual([]);
  });

  it("has no unused translations", () => {
    const unused = Object.keys(EN).filter((k) => !keys.has(k));
    expect(unused).toEqual([]);
  });
});
