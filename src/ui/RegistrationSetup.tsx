import type { CostName } from "../registration/cost";
import { shortLabel } from "../core/shortLabel";
import { Card } from "./Card";
import { InfoText } from "./Info";

import { t, tk } from "../i18n";
export type RegStatusKind = "scanner" | "registered" | "manual" | "pending" | "running" | "queued";

export interface RegRow {
  id: string;
  label: string;
  /** Short info (matrix, voxel size). */
  info: string;
  status: RegStatusKind;
  /** e.g. similarity before → after. */
  detail?: string;
  /** Not useful for intensity registration (labels, templates in standard space, derived datasets). */
  passive?: boolean;
  /** Bounding box barely overlaps the base: coordinate systems do not match. */
  mismatch?: boolean;
  /** Datasets of the same acquisition that follow this one (same frame of reference, derived label maps). */
  members?: { id: string; label: string }[];
}

export interface RegistrationSetupProps {
  datasets: { id: string; label: string; info: string }[];
  referenceId: string;
  onReferenceChange: (id: string) => void;
  /** Datasets following the base (same acquisition). */
  baseMembers: { id: string; label: string }[];
  rows: RegRow[];
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  focusId: string | null;
  onFocus: (id: string) => void;
  running: boolean;
  progressText: string | null;
  onStart: () => void;
  onCancel: () => void;
  onAccept: (id: string) => void;
  onDiscard: (id: string) => void;
  onAcceptAll: () => void;
  autoCostFor: (id: string) => CostName;
  error?: string | null;
}

const STATUS: Record<RegStatusKind, { icon: string; text: string }> = {
  scanner: { icon: "○", text: tk("Patientenkoordinaten") },
  registered: { icon: "✓", text: tk("registriert") },
  manual: { icon: "✎", text: tk("manuell/Landmarken") },
  pending: { icon: "◐", text: tk("Ergebnis prüfen") },
  running: { icon: "…", text: tk("läuft") },
  queued: { icon: "⏳", text: tk("wartet") },
};

function Members({ members, follows }: { members: { id: string; label: string }[]; follows: string }) {
  if (!members.length) return null;
  return (
    <ul className="reg-members">
      {members.map((m) => (
        <li key={m.id} title={m.label}>
          └ {shortLabel(m.label, 38)} <span className="reg-follow">folgt {follows}</span>
        </li>
      ))}
    </ul>
  );
}

/** Base (target space) selection and the list of datasets registered onto it. */
export function RegistrationSetup(props: RegistrationSetupProps) {
  const base = props.datasets.find((d) => d.id === props.referenceId);
  const anyPending = props.rows.some((r) => r.status === "pending");
  const toggle = (id: string, on: boolean) => props.onSelectedChange(on ? [...props.selected, id] : props.selected.filter((x) => x !== id));
  const selectable = props.rows.filter((r) => !r.passive).map((r) => r.id);
  const active = props.rows.filter((r) => !r.passive);
  const done = active.filter((r) => r.status === "registered").length;
  const allDone = active.length > 0 && done === active.length && !anyPending && !props.running;

  return (
    <>
      <Card
        title={<>{t("1 · Basis")}</>}
        done
        status={base ? { text: shortLabel(base.label, 28), tone: "info" } : null}
        info={
          <>
            <p>
              {t("Koregistrierung im Patientenraum – für alle Körperregionen: PET/SPECT (auch dynamische Serien; die Frames folgen der Registrierung des Mittelbilds) werden auf CT oder MRT desselben Patienten ausgerichtet, ebenso Folgeuntersuchungen auf die Basis.")}
            </p>
            <p>
              {t("Der Basis-Datensatz definiert den Raum – alle anderen werden darauf ausgerichtet und darin angezeigt. Datensätze derselben Aufnahme (gleiche FrameOfReference, z. B. PET zum CT oder die Organkarte eines CTs) folgen ihrem Datensatz automatisch.")}
            </p>
          </>
        }
      >
        <label className="field">
          {t("Basis-Datensatz")}
          <select value={props.referenceId} disabled={props.running} onChange={(e) => props.onReferenceChange(e.target.value)} title={base?.label}>
            {props.datasets.map((d) => (
              <option key={d.id} value={d.id} title={d.label}>
                {shortLabel(d.label)}
              </option>
            ))}
          </select>
        </label>
        {base && <p className="tool-hint">{base.info}</p>}
        <Members members={props.baseMembers} follows={t("der Basis")} />
      </Card>

      <Card
        title={<>{t("2 · Datensätze")}</>}
        done={allDone}
        status={active.length ? { text: t("{done}/{length} registriert", { done, length: active.length }), tone: allDone ? "ok" : anyPending ? "warn" : "info" } : null}
        info={t("Angehakte Datensätze werden nacheinander automatisch auf die Basis registriert. Klick auf eine Zeile wählt den Datensatz für „3 · Ausrichten“ (Landmarken, Einstellungen, manuelle Korrektur). Eingerückte Datensätze gehören zur selben Aufnahme und folgen automatisch.")}
      >
        <div className="reg-list">
          {props.rows.map((r) => (
            <div key={r.id} className={`reg-row${r.id === props.focusId ? " focused" : ""}`} onClick={() => props.onFocus(r.id)}>
              <input
                type="checkbox"
                checked={props.selected.includes(r.id)}
                disabled={props.running}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => toggle(r.id, e.target.checked)}
                aria-label={t("{label} registrieren", { label: r.label })}
              />
              <div className="reg-row-main">
                <div className="reg-row-title" title={r.label}>
                  {shortLabel(r.label)}
                </div>
                <div className="reg-row-info">
                  {r.info}
                  {!r.passive && ` · ${props.autoCostFor(r.id).toUpperCase()}`}
                  {r.passive && " · Labels/Vorlage"}
                </div>
                <Members members={r.members ?? []} follows={t("mit")} />
              </div>
              <div className={`reg-status reg-${r.mismatch && r.status !== "registered" && r.status !== "pending" ? "mismatch" : r.status}`} title={STATUS[r.status].text}>
                {r.mismatch && r.status !== "registered" && r.status !== "pending" ? (
                  <span title={t("Basis und Datensatz überlappen kaum – Koordinatensysteme passen nicht zusammen")}>{t("⚠ Koordinaten")}</span>
                ) : (
                  <span>
                    {STATUS[r.status].icon} {STATUS[r.status].text}
                  </span>
                )}
                {r.detail && <small>{r.detail}</small>}
              </div>
              {r.status === "pending" && (
                <div className="button-row reg-row-actions">
                  <button className="secondary-btn toggled" onClick={(e) => (e.stopPropagation(), props.onAccept(r.id))}>
                    {t("Übernehmen")}
                  </button>
                  <button className="secondary-btn" onClick={(e) => (e.stopPropagation(), props.onDiscard(r.id))}>
                    {t("Verwerfen")}
                  </button>
                </div>
              )}
            </div>
          ))}
          {props.rows.length === 0 && <p className="tool-hint">{t("Kein weiterer Datensatz zu registrieren.")}</p>}
        </div>
        <div className="button-row">
          <button className="link-btn" disabled={props.running} onClick={() => props.onSelectedChange(selectable)}>
            {t("alle")}
          </button>
          <button className="link-btn" disabled={props.running} onClick={() => props.onSelectedChange([])}>
            {t("keine")}
          </button>
        </div>
        {!props.running ? (
          <button className={anyPending ? "secondary-btn" : "primary-btn"} disabled={props.selected.length === 0} onClick={props.onStart}>
            {props.selected.length > 1 ? t("{length} Datensätze automatisch registrieren", { length: props.selected.length }) : t("Angehakten Datensatz automatisch registrieren")}
          </button>
        ) : (
          <>
            <p className="tool-hint">{props.progressText ?? "Vorbereitung …"}</p>
            <button className="secondary-btn" onClick={props.onCancel}>
              {t("Abbrechen")}
            </button>
          </>
        )}
        {anyPending && !props.running && (
          <>
            <InfoText details={t("Die Ansicht zeigt die Ergebnisse bereits – bitte prüfen (Zeile anklicken = als Overlay zeigen), dann übernehmen oder verwerfen.")}>{t("Ergebnisse prüfen")}</InfoText>
            <button className="primary-btn" onClick={props.onAcceptAll}>
              {t("Alle Ergebnisse übernehmen")}
            </button>
          </>
        )}
        {props.error && <div className="error-banner">{props.error}</div>}
      </Card>
    </>
  );
}
