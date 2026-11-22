import { Info } from "lucide-react";
import { type ReactNode, useState } from "react";

import { t } from "../i18n";
/** Card heading with an optional ⓘ button that unfolds a longer explanation below it. */
export function CardTitle({ children, info }: { children: ReactNode; info?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="card-title">
        <h3>{children}</h3>
        {info && <InfoButton open={open} onToggle={() => setOpen((o) => !o)} />}
      </div>
      {info && open && <div className="info-text">{info}</div>}
    </>
  );
}

/** Short visible text plus an ⓘ that unfolds the details (for places without a card heading). */
export function InfoText({ children, details, warn }: { children?: ReactNode; details: ReactNode; warn?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className={warn ? "tool-hint tool-warning info-line" : "tool-hint info-line"}>
        {children}
        <InfoButton open={open} onToggle={() => setOpen((o) => !o)} />
      </p>
      {open && <div className="info-text">{details}</div>}
    </>
  );
}

export function InfoButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={open ? "info-btn open" : "info-btn"} aria-expanded={open} aria-label={t("Erläuterung")} title={open ? t("Erläuterung ausblenden") : t("Erläuterung anzeigen")} onClick={onToggle}>
      <Info size={14} />
    </button>
  );
}
