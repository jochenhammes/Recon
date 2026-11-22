import type { ReactNode } from "react";
import { Card } from "./Card";
import { shortLabel } from "../core/shortLabel";

import { tr, tk } from "../i18n";
export type AlignTab = "landmarks" | "auto" | "manual";

export interface AlignCardProps {
  /** Datasets that can be aligned: groups first, then single members ("einzeln"). */
  targets: { id: string; label: string; single?: boolean }[];
  targetId: string;
  onTargetChange: (id: string) => void;
  tab: AlignTab;
  onTabChange: (tab: AlignTab) => void;
  mismatch: boolean;
  /** Status of the target (e.g. "registriert"). */
  status?: { text: string; tone?: "ok" | "warn" | "info" | "run" } | null;
  landmarks: ReactNode;
  auto: ReactNode;
  manual: ReactNode;
  /** Rarely used tools (matrix file, reset, origin into the file). */
  advanced: ReactNode;
}

const TABS: { id: AlignTab; label: string; sub?: string; title: string }[] = [
  { id: "landmarks", label: tk("① Landmarken"), sub: "optional", title: tk("Grob ausrichten über zwei anatomische Punkte – vor der automatischen Registrierung") },
  { id: "auto", label: tk("② Automatisch"), title: tk("Intensitätsbasierte Registrierung auf die Basis") },
  { id: "manual", label: tk("Manuell"), title: tk("Verschieben und Drehen von Hand (Nachkorrektur)") },
];

/** One card for aligning one dataset to the base: landmarks → automatic → manual. */
export function AlignCard(props: AlignCardProps) {
  const target = props.targets.find((t) => t.id === props.targetId);
  return (
    <Card
      title={<>{tr("3 · Ausrichten")}</>}
      persistKey="coreg-align"
      status={props.mismatch ? { text: tr("⚠ Koordinaten"), tone: "warn" } : (props.status ?? null)}
      info={tr("Richtet einen Datensatz auf die Basis aus: zuerst optional grob über Landmarken, dann automatisch, bei Bedarf von Hand. Datensätze derselben Aufnahme folgen automatisch.")}
    >
      <label className="field">
        {tr("Datensatz")}
        <select value={props.targetId} onChange={(e) => props.onTargetChange(e.target.value)} title={target?.label}>
          {props.targets.map((t) => (
            <option key={t.id} value={t.id} title={t.label}>
              {shortLabel(t.label)}
              {t.single ? tr(" (einzeln, ohne seine Aufnahme)") : ""}
            </option>
          ))}
        </select>
      </label>
      {props.mismatch && (
        <p className="tool-hint tool-warning" title={tr("Basis und Datensatz überlappen kaum – die Koordinatensysteme passen nicht zusammen. Zuerst über Landmarken ausrichten.")}>
          {tr("Koordinaten passen nicht → Landmarken")}
        </p>
      )}
      <div className="segmented-control align-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={props.tab === t.id} className={props.tab === t.id ? "active" : ""} title={t.title} onClick={() => props.onTabChange(t.id)}>
            {t.label}
            {t.sub && <small className="tab-sub">{t.sub}</small>}
          </button>
        ))}
      </div>
      <div role="tabpanel">{props.tab === "landmarks" ? props.landmarks : props.tab === "auto" ? props.auto : props.manual}</div>
      <details className="compact-details">
        <summary>{tr("Erweitert")}</summary>
        {props.advanced}
      </details>
    </Card>
  );
}
