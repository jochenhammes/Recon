import { useState } from "react";
import { INTERPOLATION_LABELS, type Interpolation } from "../resample/resample";
import type { Normalization } from "../normalization/model";

export interface Option {
  id: string;
  label: string;
}

export type NormMethod = "affine" | "nonlinear";
export type Regularization = "light" | "medium" | "heavy";

export interface NormalizationPanelProps {
  templates: Option[];
  templateId: string | null;
  onTemplateChange: (id: string) => void;
  onLoadMni: () => void;
  mniLoading: boolean;
  subjects: Option[];
  subjectId: string | null;
  onSubjectChange: (id: string) => void;
  subjectKind: "T1" | "PET";
  onSubjectKindChange: (k: "T1" | "PET") => void;
  method: NormMethod;
  onMethodChange: (m: NormMethod) => void;
  nonlinearAvailable: boolean;
  regularization: Regularization;
  onRegularizationChange: (r: Regularization) => void;
  useMask: boolean;
  onUseMaskChange: (v: boolean) => void;
  maskAvailable: boolean;
  costLabel: string;
  running: boolean;
  progress: { stage: string; detail: string; fraction: number } | null;
  onStart: () => void;
  onCancel: () => void;
  normalization: Normalization | null;
  /** Datasets that can be transferred (subject and datasets registered to it). */
  transferCandidates: Option[];
  onTransfer: (ids: string[], method: Interpolation) => void;
  transferStatus: string | null;
  transferBusy: boolean;
  /** Optional extras (e.g. deformation-field import/export). */
  children?: React.ReactNode;
  error?: string | null;
}

/** Spatial normalization of a subject to a standard-space template and transfer of datasets. */
export function NormalizationPanel(props: NormalizationPanelProps) {
  const [selected, setSelected] = useState<string[] | null>(null);
  const [interp, setInterp] = useState<Interpolation>("linear");
  const ids = selected ?? props.transferCandidates.map((c) => c.id);
  const { normalization, running } = props;

  return (
    <>
      <section className="card">
        <h3>Vorlage</h3>
        {props.templates.length === 0 ? (
          <>
            <p className="hint">Noch keine Vorlage geladen.</p>
            <button className="secondary-btn" disabled={props.mniLoading} onClick={props.onLoadMni}>
              {props.mniLoading ? "Wird geladen …" : "MNI152 2009c (T1, 2 mm) laden"}
            </button>
            <p className="hint">Eigene Vorlagen (T1 oder Tracer-PET) im Panel „Daten“ unter „Standardraum-Vorlage“.</p>
          </>
        ) : (
          <label className="field">
            Standardraum
            <select value={props.templateId ?? ""} disabled={running} onChange={(e) => props.onTemplateChange(e.target.value)}>
              {props.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {props.templates.length > 0 && (
        <section className="card">
          <h3>Normalisierung schätzen</h3>
          <label className="field">
            Subjekt (meist das T1-MRT; ohne MRT das PET)
            <select value={props.subjectId ?? ""} disabled={running} onChange={(e) => props.onSubjectChange(e.target.value)}>
              {props.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Kontrast des Subjekts
            <select value={props.subjectKind} disabled={running} onChange={(e) => props.onSubjectKindChange(e.target.value as "T1" | "PET")}>
              <option value="T1">T1-MRT</option>
              <option value="PET">PET</option>
            </select>
          </label>
          <div className="segmented-control" role="group" aria-label="Methode">
            <button className={props.method === "affine" ? "active" : ""} disabled={running} onClick={() => props.onMethodChange("affine")}>
              Affin (12)
            </button>
            <button
              className={props.method === "nonlinear" ? "active" : ""}
              disabled={running || !props.nonlinearAvailable}
              title={props.nonlinearAvailable ? undefined : "Nur bei gleichem Kontrast (T1↔T1-Vorlage, PET↔PET-Vorlage)"}
              onClick={() => props.onMethodChange("nonlinear")}
            >
              Affin + nichtlinear
            </button>
          </div>
          {props.method === "nonlinear" && (
            <label className="field">
              Regularisierung
              <select value={props.regularization} disabled={running} onChange={(e) => props.onRegularizationChange(e.target.value as Regularization)}>
                <option value="light">leicht (mehr Verformung)</option>
                <option value="medium">mittel (Standard)</option>
                <option value="heavy">stark (glatter)</option>
              </select>
            </label>
          )}
          {!props.nonlinearAvailable && <p className="tool-hint">Nichtlinear nur bei gleichem Kontrast von Subjekt und Vorlage (T1↔T1 bzw. PET↔PET-Vorlage).</p>}
          <label className="checkbox-field">
            <input type="checkbox" checked={props.useMask && props.maskAvailable} disabled={running || !props.maskAvailable} onChange={(e) => props.onUseMaskChange(e.target.checked)} />
            Nur Gehirn der Vorlage verwenden (Hirnmaske)
          </label>
          <p className="tool-hint">Kostenfunktion: {props.costLabel}. Startpunkt per Schwerpunkt und Rotationsraster (die Scanner-Koordinaten liegen meist weit vom MNI-Ursprung).</p>
          {!running ? (
            <button className="primary-btn" disabled={!props.subjectId || !props.templateId} onClick={props.onStart}>
              Normalisierung starten
            </button>
          ) : (
            <>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${Math.round((props.progress?.fraction ?? 0.03) * 100)}%` }} />
              </div>
              <p className="tool-hint">{props.progress ? `${props.progress.stage} · ${props.progress.detail}` : "Vorbereitung …"}</p>
              <button className="secondary-btn" onClick={props.onCancel}>
                Abbrechen
              </button>
            </>
          )}
          {normalization && (
            <p className="tool-hint">
              Aktuelle Normalisierung: {normalization.kind === "affine" ? "affin" : normalization.kind === "nonlinear" ? "affin + nichtlinear" : "importiertes Verformungsfeld"} →{" "}
              {normalization.templateName}
              {normalization.cost && ` (${normalization.cost.name}: ${normalization.cost.before.toFixed(3)} → ${normalization.cost.after.toFixed(3)})`}
            </p>
          )}
          {props.error && <div className="error-banner">{props.error}</div>}
        </section>
      )}

      {normalization && (
        <section className="card">
          <h3>In Standardraum übertragen</h3>
          <p className="hint">
            Datensätze, die mit dem Subjekt coregistriert sind (z. B. das PET zum T1), werden über die Verformung des Subjekts in den Standardraum
            resampelt und als neue Datensätze angelegt (Vorlage wird Referenz).
          </p>
          {props.transferCandidates.map((c) => (
            <label key={c.id} className="checkbox-field">
              <input
                type="checkbox"
                checked={ids.includes(c.id)}
                disabled={props.transferBusy}
                onChange={(e) => setSelected(e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id))}
              />
              {c.label}
            </label>
          ))}
          <label className="field">
            Interpolation
            <select value={interp} disabled={props.transferBusy} onChange={(e) => setInterp(e.target.value as Interpolation)}>
              {(Object.keys(INTERPOLATION_LABELS) as Interpolation[]).map((m) => (
                <option key={m} value={m}>
                  {INTERPOLATION_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-btn" disabled={props.transferBusy || ids.length === 0} onClick={() => props.onTransfer(ids, interp)}>
            {props.transferBusy ? "Wird übertragen …" : "Übertragen"}
          </button>
          {props.transferStatus && <p className="tool-hint">{props.transferStatus}</p>}
        </section>
      )}
      {props.children}
    </>
  );
}
