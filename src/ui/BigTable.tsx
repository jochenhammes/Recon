import { Download, Maximize2, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { csvText, csvWithInfo } from "../core/csv";

interface Extracted {
  head: string[];
  rows: { cells: string[]; index: number; selected: boolean }[];
}

/** Reads header and body cells of the first table inside `root`. */
function extract(root: HTMLElement | null): Extracted {
  const table = root?.querySelector("table");
  if (!table) return { head: [], rows: [] };
  const head = [...table.querySelectorAll("thead tr:last-child th")].map((th) => th.textContent?.trim() ?? "");
  const rows = [...table.querySelectorAll("tbody tr")].map((tr, index) => ({
    cells: [...tr.querySelectorAll("td")].map((td) => td.textContent?.trim() ?? ""),
    index,
    selected: /\b(reference-row|selected|active)\b/.test(tr.className),
  }));
  return { head, rows };
}

/** German number in a cell ("1.234,5 SUV", "−0,3") → number, else NaN. */
function cellNumber(s: string): number {
  const m = s.replace(/−/g, "-").match(/^[-+]?[\d.]*\d(,\d+)?/);
  if (!m) return NaN;
  return Number(m[0].replace(/\./g, "").replace(",", "."));
}

function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };
const safeName = (s: string) =>
  s
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c])
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "") || "Tabelle";

/**
 * Result table in the side panel with a ⤢ button that shows it large over the viewer (search, sort, CSV).
 * The large view mirrors the panel table (live); clicking a row there clicks the row in the panel.
 */
export function BigTable({ title, children, onCsv, csvInfo = [] }: { title: string; children: ReactNode; onCsv?: () => void; csvInfo?: [string, string][] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Extracted>({ head: [], rows: [] });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);

  useEffect(() => {
    if (!open) return;
    const update = () => setData(extract(ref.current));
    update();
    const obs = new MutationObserver(update);
    if (ref.current) obs.observe(ref.current, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    return () => {
      obs.disconnect();
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = q ? data.rows.filter((x) => x.cells.some((c) => c.toLowerCase().includes(q))) : data.rows;
    if (sort) {
      r = [...r].sort((a, b) => {
        const x = a.cells[sort.col] ?? "", y = b.cells[sort.col] ?? "";
        const nx = cellNumber(x), ny = cellNumber(y);
        const c = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y, "de", { numeric: true });
        return c * sort.dir;
      });
    }
    return r;
  }, [data, query, sort]);

  const csv = () => {
    if (onCsv) return onCsv();
    const d = extract(ref.current);
    const lines = [d.head.map(csvText).join(";"), ...d.rows.map((r) => r.cells.map((c) => (Number.isFinite(cellNumber(c)) && /^[-+−\d.,\s]+$/.test(c) ? c : csvText(c))).join(";"))];
    downloadText(csvWithInfo(lines, [["Tabelle", title], ["Erstellt", new Date().toLocaleString("de-DE")], ...csvInfo]), `${safeName(title)}.csv`);
  };

  const clickRow = (index: number) => {
    const tr = ref.current?.querySelectorAll("tbody tr")[index] as HTMLElement | undefined;
    tr?.click();
  };

  const workspace = typeof document !== "undefined" ? document.querySelector(".workspace") : null;
  return (
    <>
      <div className="big-table">
        <div className="big-table-tools">
          <button className="icon-btn small" title="Tabelle groß über dem Viewer anzeigen" aria-label="Tabelle vergrößern" onClick={() => setOpen(true)}>
            <Maximize2 size={13} />
          </button>
        </div>
        <div ref={ref} className="region-table-wrap">
          {children}
        </div>
      </div>
      {open &&
        workspace &&
        createPortal(
          <div className="table-overlay" role="dialog" aria-label={title}>
            <div className="table-overlay-head">
              <h3>{title}</h3>
              <label className="table-overlay-search">
                <Search size={13} />
                <input type="search" placeholder="Suchen …" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <span className="table-overlay-count">
                {rows.length} / {data.rows.length} Zeilen
              </span>
              <button className="secondary-btn" onClick={csv}>
                <Download size={13} /> CSV
              </button>
              <button className="icon-btn small" title="Schließen (Esc)" aria-label="Schließen" onClick={() => setOpen(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="table-overlay-body">
              <table className="region-table">
                <thead>
                  <tr>
                    {data.head.map((h, i) => (
                      <th key={i} aria-sort={sort?.col === i ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                        <button
                          className="th-sort"
                          title="Sortieren"
                          onClick={() => setSort((s) => (s?.col === i ? (s.dir === 1 ? { col: i, dir: -1 } : null) : { col: i, dir: 1 }))}
                        >
                          {h}
                          {sort?.col === i ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.index} className={`clickable${r.selected ? " reference-row" : ""}`} onClick={() => clickRow(r.index)}>
                      {r.cells.map((c, i) => (
                        <td key={i}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>,
          workspace,
        )}
    </>
  );
}
