import { Download, Printer, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { t } from "../i18n";
/**
 * Dosimetry report shown large over the viewer (like the enlarged tables): the self-contained HTML in a sandboxed
 * frame, with print/PDF, download and close (Esc).
 */
export function ReportOverlay({ html, title, onDownload, onClose }: { html: string; title: string; onDownload: () => void; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const workspace = typeof document !== "undefined" ? document.querySelector(".workspace") : null;
  if (!workspace) return null;
  return createPortal(
    <div className="table-overlay report-overlay" role="dialog" aria-label={title}>
      <div className="table-overlay-head">
        <h3>{title}</h3>
        <button className="secondary-btn" onClick={() => frame.current?.contentWindow?.print()} title={t("Drucken oder als PDF speichern")}>
          <Printer size={13} /> Drucken / PDF
        </button>
        <button className="secondary-btn" onClick={onDownload}>
          <Download size={13} /> HTML
        </button>
        <button className="icon-btn small" title={t("Schließen (Esc)")} aria-label={t("Schließen")} onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {/* allow-modals: print dialog; scripts stay off (the report has none). */}
      <iframe ref={frame} className="report-frame" title={title} srcDoc={html} sandbox="allow-same-origin allow-modals" />
    </div>,
    workspace,
  );
}
