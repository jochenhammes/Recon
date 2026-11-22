import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderMarkdown, slug } from "./markdown";

describe("markdown for the manual", () => {
  it("makes GitHub-style anchors", () => {
    expect(slug("9. Dosimetrie (SPECT/CT)")).toBe("9-dosimetrie-spectct");
    expect(slug("9. CT-Organsegmentierung")).toBe("9-ct-organsegmentierung");
    expect(slug("10. Segmentierung & MTV")).toBe("10-segmentierung--mtv");
  });

  it("renders headings, lists, tables, code, links, images and escapes HTML", () => {
    const html = renderMarkdown(
      [
        "# Titel",
        "",
        "Text mit **fett**, *kursiv*, `code <x>` und [Link](#9-ct) sowie <script>.",
        "",
        "1. Eins",
        "   - Unterpunkt",
        "2. Zwei",
        "",
        "| A | B |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "![Bild](docs/images/x.jpg)",
        "",
        "```",
        "a < b",
        "```",
      ].join("\n"),
      { imageUrl: (p) => `/assets/${p.split("/").pop()}` },
    );
    expect(html).toContain('<h1 id="titel">Titel</h1>');
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain("<em>kursiv</em>");
    expect(html).toContain("<code>code &lt;x&gt;</code>");
    expect(html).toContain('<a href="#9-ct">Link</a>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toMatch(/<ol><li>Eins<ul><li>Unterpunkt<\/li><\/ul><\/li><li>Zwei<\/li><\/ol>/);
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>2</td>");
    expect(html).toContain('<img src="/assets/x.jpg"');
    expect(html).toContain("<pre><code>a &lt; b</code></pre>");
  });

  it("renders the real manual and every table-of-contents link has a target", () => {
    const md = readFileSync(new URL("../../MANUAL.md", import.meta.url), "utf8");
    const html = renderMarkdown(md);
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const links = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
    const missing = links.filter((l) => !ids.has(l));
    expect(missing).toEqual([]);
    expect(html).toContain("9-dosimetrie-spectct");
  });
});

describe("hard line breaks", () => {
  it("turns a trailing backslash or two spaces into <br>", async () => {
    const { renderMarkdown } = await import("./markdown");
    expect(renderMarkdown("Name\\\nStraße 1  \nOrt")).toBe("<p>Name<br>Straße 1<br>Ort</p>");
    expect(renderMarkdown("a\nb")).toBe("<p>a b</p>");
  });
});
