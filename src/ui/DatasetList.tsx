import { ChevronRight, Eye, EyeOff, MoreHorizontal, PenLine } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface DatasetRow {
  id: string;
  /** Modality code/label (PT, CT, MR, Labels, …). */
  modality: string;
  name: string;
  /** Full name (tooltip). */
  title: string;
  tag?: string;
  isBase: boolean;
  /** Displayed in the viewer (base or visible overlay). */
  isShown: boolean;
  isActive: boolean;
  /** Short extra info, e.g. "bearbeitet", "dynamisch". */
  notes: string[];
}

const MOD_CLASS: Record<string, string> = { PT: "mod-pt", NM: "mod-nm", CT: "mod-ct", MR: "mod-mr", Labels: "mod-labels" };

/** One row per dataset (modality, name, roles); click expands the details. */
export function DatasetList({
  rows,
  details,
  onToggleShown,
  onActivate,
  onMakeBase,
  onRemove,
}: {
  rows: DatasetRow[];
  details: (id: string) => ReactNode;
  onToggleShown: (id: string) => void;
  onActivate: (id: string) => void;
  onMakeBase: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const single = rows.length === 1;
  return (
    <section className="card dataset-list">
      <h3>Datensätze ({rows.length})</h3>
      <ul>
        {rows.map((r) => {
          const expanded = single || open.has(r.id);
          return (
            <li key={r.id} className={`${r.isActive && !single ? "active " : ""}${expanded ? "expanded" : ""}`}>
              <div className="dataset-row">
                <button
                  className="dataset-row-main"
                  aria-expanded={expanded}
                  title={`${r.title} – Details ${expanded ? "ausblenden" : "anzeigen"}`}
                  onClick={() =>
                    !single &&
                    setOpen((o) => {
                      const n = new Set(o);
                      if (n.has(r.id)) n.delete(r.id);
                      else n.add(r.id);
                      return n;
                    })
                  }
                >
                  {!single && <ChevronRight size={14} className="chevron" />}
                  <span className={`mod-badge ${MOD_CLASS[r.modality] ?? "mod-other"}`}>{r.modality}</span>
                  <span className="dataset-row-name">
                    {r.tag && <strong>{r.tag}</strong>}
                    <span>{r.name}</span>
                  </span>
                  {r.isBase && !single && <span className="role-badge reference">Basis</span>}
                  {r.notes.map((n) => (
                    <span key={n} className="row-note">
                      {n}
                    </span>
                  ))}
                </button>
                {!single && (
                  <>
                    <button
                      className={`icon-btn small${r.isShown ? " on" : ""}`}
                      disabled={r.isBase}
                      title={r.isBase ? "Basis der Ansicht (immer angezeigt)" : r.isShown ? "Ausblenden" : "Im Viewer einblenden"}
                      aria-label={r.isShown ? "Ausblenden" : "Einblenden"}
                      onClick={() => onToggleShown(r.id)}
                    >
                      {r.isShown ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button
                      className={`icon-btn small${r.isActive ? " on" : ""}`}
                      aria-pressed={r.isActive}
                      title={r.isActive ? "Aktiv: Analyse, Bearbeiten, Header und Export beziehen sich auf diesen Datensatz" : "Für Analyse, Bearbeiten, Header und Export wählen"}
                      aria-label="Aktiv setzen"
                      onClick={() => onActivate(r.id)}
                    >
                      <PenLine size={14} />
                    </button>
                  </>
                )}
                <RowMenu
                  open={menu === r.id}
                  onOpenChange={(o) => setMenu(o ? r.id : null)}
                  items={[
                    ...(!r.isBase && !single ? [{ label: "Als Basis der Ansicht", action: () => onMakeBase(r.id) }] : []),
                    { label: "Datensatz entfernen", action: () => onRemove(r.id), danger: true },
                  ]}
                />
              </div>
              {expanded && <div className="dataset-row-details">{details(r.id)}</div>}
            </li>
          );
        })}
      </ul>
      {rows.length > 1 && (
        <p className="tool-hint dataset-legend">
          <Eye size={11} /> eingeblendet · <PenLine size={11} /> aktiv (Analyse, Bearbeiten, Export)
        </p>
      )}
    </section>
  );
}

function RowMenu({ open, onOpenChange, items }: { open: boolean; onOpenChange: (o: boolean) => void; items: { label: string; action: () => void; danger?: boolean }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open, onOpenChange]);
  return (
    <div className="row-menu" ref={ref}>
      <button className="icon-btn small" aria-haspopup="menu" aria-expanded={open} title="Weitere Aktionen" aria-label="Weitere Aktionen" onClick={() => onOpenChange(!open)}>
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="row-menu-list" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={it.danger ? "danger" : ""}
              onClick={() => {
                onOpenChange(false);
                it.action();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
