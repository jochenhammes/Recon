import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { InfoButton } from "./Info";

export type CardTone = "ok" | "run" | "warn" | "info";

export interface CardProps {
  title: ReactNode;
  /** Longer explanation behind ⓘ. */
  info?: ReactNode;
  /** Badge in the header, e.g. { text: "fertig", tone: "ok" }. */
  status?: { text: string; tone?: CardTone } | null;
  /** Step done: the card folds automatically (until the user opens it again). */
  done?: boolean;
  /** Initial state (default open). */
  defaultOpen?: boolean;
  /** Remember the user's open/closed choice in the browser under this key. */
  persistKey?: string;
  className?: string;
  children?: ReactNode;
}

function readStored(key?: string): boolean | undefined {
  if (!key) return undefined;
  try {
    const v = localStorage.getItem(`recon-studio-card:${key}`);
    return v === null ? undefined : v === "1";
  } catch {
    return undefined;
  }
}

/** Collapsible card with title, ⓘ explanation and status badge. */
export function Card({ title, info, status, done, defaultOpen = true, persistKey, className, children }: CardProps) {
  const [choice, setChoice] = useState<boolean | undefined>(() => readStored(persistKey));
  const [infoOpen, setInfoOpen] = useState(false);
  // A step that becomes done folds (and one that is no longer done unfolds), whatever was chosen before.
  const prevDone = useRef(done);
  useEffect(() => {
    if (prevDone.current !== done && done !== undefined) setChoice(undefined);
    prevDone.current = done;
  }, [done]);
  const open = choice ?? (done ? false : defaultOpen);
  const toggle = () => {
    const next = !open;
    setChoice(next);
    if (persistKey)
      try {
        localStorage.setItem(`recon-studio-card:${persistKey}`, next ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
  };
  const tone = status?.tone ?? (done ? "ok" : "info");
  return (
    <section className={`card fold-card${open ? " open" : ""}${className ? ` ${className}` : ""}`}>
      <div className="fold-head">
        <button type="button" className="fold-toggle" aria-expanded={open} onClick={toggle}>
          <ChevronRight size={14} className="chevron" />
          <h3>{title}</h3>
        </button>
        {(status || done) && <span className={`fold-status tone-${tone}`}>{status?.text ?? "✓ fertig"}</span>}
        {info && <InfoButton open={infoOpen} onToggle={() => setInfoOpen((o) => !o)} />}
      </div>
      {infoOpen && <div className="info-text">{info}</div>}
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}
