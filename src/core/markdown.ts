/**
 * Minimal Markdown → HTML for the in-app manual (headings with GitHub anchors, paragraphs, nested lists, tables,
 * fenced code, horizontal rules, emphasis, code, links, images). Input is escaped; only the generated tags are HTML.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** GitHub-style heading anchor: lower case, punctuation removed (letters incl. umlauts, digits, "-", "_" kept), spaces → "-". */
export function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export interface MarkdownOptions {
  /** Maps an image path from the Markdown (e.g. "docs/images/01-start.jpg") to a URL; undefined drops the image. */
  imageUrl?: (path: string) => string | undefined;
}

function inline(text: string, o: MarkdownOptions): string {
  // Code spans first (their content stays literal).
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt: string, src: string) => {
    const url = o.imageUrl ? o.imageUrl(src) : src;
    return url ? `<img src="${esc(url)}" alt="${alt}" loading="lazy">` : "";
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
    const external = /^https?:/i.test(href);
    return `<a href="${href}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\uE000(\d+)\uE000/g, (_, i: string) => codes[Number(i)]);
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function renderMarkdown(md: string, o: MarkdownOptions = {}): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const listItem = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

  /** Renders a list block starting at line i with the given indentation; returns when the block ends. */
  const renderList = (indent: number): string => {
    const first = listItem.exec(lines[i])!;
    const ordered = /\d/.test(first[2]);
    let html = ordered ? "<ol>" : "<ul>";
    while (i < lines.length) {
      const m = listItem.exec(lines[i]);
      if (!m || m[1].length < indent) break;
      if (m[1].length > indent) {
        html = html.replace(/<\/li>$/, "") + renderList(m[1].length) + "</li>";
        continue;
      }
      let text = m[3];
      i++;
      // Continuation lines (indented, not a new item), and nested lists.
      while (i < lines.length && lines[i].trim() && !listItem.test(lines[i]) && /^\s+/.test(lines[i]) && !isTableRow(lines[i])) text += " " + lines[i++].trim();
      let nested = "";
      while (i < lines.length) {
        const n = listItem.exec(lines[i]);
        if (n && n[1].length > indent) nested += renderList(n[1].length);
        else if (!lines[i].trim() && listItem.exec(lines[i + 1] ?? "") && (listItem.exec(lines[i + 1])![1].length >= indent)) i++;
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && !n) {
          // Indented block inside an item (e.g. a table or paragraph): render it on its own.
          const block: string[] = [];
          while (i < lines.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !listItem.test(lines[i])) block.push(lines[i++].trim());
          nested += renderMarkdown(block.join("\n"), o);
        } else break;
      }
      html += `<li>${inline(text, o)}${nested}</li>`;
    }
    return html + (ordered ? "</ol>" : "</ul>");
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*```/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const text = h[2].trim();
      out.push(`<h${h[1].length} id="${esc(slug(text.replace(/[*`]/g, "")))}">${inline(text, o)}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c, o)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c, o)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    const li = listItem.exec(line);
    if (li) {
      out.push(renderList(li[1].length));
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${renderMarkdown(q.join("\n"), o)}</blockquote>`);
      continue;
    }
    // Paragraph: until a blank line or another block.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i]) && !listItem.test(lines[i]) && !/^\s*```/.test(lines[i]) && !(isTableRow(lines[i]) && isTableRow(lines[i + 1] ?? "")) && !/^\s*---+\s*$/.test(lines[i]))
      para.push(lines[i++].trim());
    if (para.length) out.push(`<p>${inline(para.join(" "), o)}</p>`);
    else i++;
  }
  return out.join("\n");
}
