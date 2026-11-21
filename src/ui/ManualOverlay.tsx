import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { renderMarkdown } from "../core/markdown";

// Screenshots of the manual, bundled with the app (paths in MANUAL.md: docs/images/<name>).
const IMAGES = import.meta.glob("../../docs/images/*.{jpg,jpeg,png,gif,svg}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const imageUrl = (path: string) => {
  const name = path.split("/").pop();
  return Object.entries(IMAGES).find(([k]) => k.endsWith(`/${name}`))?.[1];
};

/** The manual (MANUAL.md) large over the viewer; table-of-contents links scroll within it. Close with Esc. */
export function ManualOverlay({ onClose }: { onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    // Loaded on demand: the manual is not part of the main bundle.
    void import("../../MANUAL.md?raw").then((m) => alive && setHtml(renderMarkdown(m.default, { imageUrl })));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => {
      alive = false;
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!a || !href?.startsWith("#")) return;
    e.preventDefault();
    const target = body.current?.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`);
    target?.scrollIntoView({ block: "start" });
  };

  const workspace = typeof document !== "undefined" ? document.querySelector(".workspace") : null;
  if (!workspace) return null;
  return createPortal(
    <div className="table-overlay manual-overlay" role="dialog" aria-label="Handbuch">
      <div className="table-overlay-head">
        <h3>Handbuch</h3>
        <button className="secondary-btn" onClick={() => body.current?.scrollTo({ top: 0, behavior: "smooth" })}>
          Inhalt
        </button>
        <button className="icon-btn small" title="Schließen (Esc)" aria-label="Schließen" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div ref={body} className="manual-body" onClick={onClick}>
        {html === null ? <p className="tool-hint">Handbuch wird geladen …</p> : <article className="manual" dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    </div>,
    workspace,
  );
}
