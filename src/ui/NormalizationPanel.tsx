import { useState } from "react";
import { Card } from "./Card";
import { INTERPOLATION_LABELS, type Interpolation } from "../resample/resample";
import type { Normalization } from "../normalization/model";
import type { TemplateKind } from "../normalization/templates";

export interface Option {
  id: string;
  label: string;
}

export type NormMethod = "affine" | "nonlinear";
export type Regularization = "light" | "medium" | "heavy";

export interface NormalizationPanelProps {
  /** Loaded templates and bundled ones (loaded on demand). */
  templates: (Option & { kind: TemplateKind })[];
  templateId: string | null;
  onTemplateChange: (id: string) => void;
  subjects: Option[];
  subjectId: string | null;
  onSubjectChange: (id: string) => void;
  subjectKind: TemplateKind;
  onSubjectKindChange: (k: TemplateKind) => void;
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
  /** All patient-space datasets (transferred together after the normalization). */
  transferCandidates: Option[];
  /** Datasets currently in the standard space of the normalization. */
  transferred: Option[];
  onTransfer: (ids: string[], method: Interpolation) => void;
  transferStatus: string | null;
  transferBusy: boolean;
  /** Optional extras (e.g. deformation-field import/export). */
  children?: React.ReactNode;
  error?: string | null;
}

const KIND_LABEL: Record<TemplateKind, string> = { T1: "T1-MRT", PET: "PET/SPECT", CT: "CT" };

/**
 * Spatial normalization into a standard space (brain only): one patient dataset (MR, PET/SPECT or CT) is matched
 * to the template of its contrast; all patient-space datasets are then transferred with it.
 */
export function NormalizationPanel(props: NormalizationPanelProps) {
  const [selected, setSelected] = useState<string[] | null>(null);
  const [interp, setInterp] = useState<Interpolation>("linear");
  const ids = (selected ?? props.transferCandidates.map((c) => c.id)).filter((id) => props.transferCandidates.some((c) => c.id === id));
  const { normalization, running } = props;
  const template = props.templates.find((t) => t.id === props.templateId);

  return (
    <>
      <Card
        title={<>1 · Normalisierung</>}
        info={
          <>
            <p>
              Räumliche Normalisierung in den MNI-Standardraum – nur für Hirnuntersuchungen. Grundlage ist ein Datensatz des Patienten: am besten
              das T1-MRT, sonst das Hirn-PET/SPECT oder das Kopf-CT (z. B. aus dem PET/CT). Die Vorlage wird passend gewählt: T1 → MNI152-T1,
              PET → SPM-PET, SPECT → SPM-SPECT, CT → SPM-Transmissionsbild.
            </p>
            <p>
              Alle anderen Datensätze werden über ihre Koregistrierung mit diesem Datensatz mitgenommen – PET also vorher im Bereich
              „Koregistrierung“ auf das CT/MRT registrieren.
            </p>
            <p>Kostenfunktion: {props.costLabel}. Startpunkt per Schwerpunkt und Rotationsraster. Nichtlinear nur bei gleichem Kontrast von Datensatz und Vorlage.</p>
          </>
        }
        done={!!normalization && !running}
        status={running ? { text: "läuft", tone: "run" } : normalization ? { text: normalization.kind === "affine" ? "✓ affin" : normalization.kind === "nonlinear" ? "✓ nichtlinear" : "✓ Feld", tone: "ok" } : null}
      >
        <label className="field">
          Grundlage (Patientendatensatz)
          <select value={props.subjectId ?? ""} disabled={running} onChange={(e) => props.onSubjectChange(e.target.value)}>
            {props.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="norm-fields">
          <label className="field">
            Kontrast
            <select value={props.subjectKind} disabled={running} onChange={(e) => props.onSubjectKindChange(e.target.value as TemplateKind)}>
              {(Object.keys(KIND_LABEL) as TemplateKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Vorlage
            <select value={props.templateId ?? ""} disabled={running} onChange={(e) => props.onTemplateChange(e.target.value)}>
              {props.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {template && template.kind !== props.subjectKind && <p className="warning-banner">Vorlage ({KIND_LABEL[template.kind]}) passt nicht zum Kontrast ({KIND_LABEL[props.subjectKind]}) – nur affin mit Mutual Information.</p>}
        {props.subjectKind === "CT" && <p className="tool-hint">CT: nur Kopf-CT (Sichtfeld Kopf); bei Ganzkörper-CT vorher auf den Kopf zuschneiden (Bearbeiten → VOI/Zuschnitt).</p>}
        <div className="segmented-control" role="group" aria-label="Methode">
          <button className={props.method === "affine" ? "active" : ""} disabled={running} onClick={() => props.onMethodChange("affine")}>
            Affin (12)
          </button>
          <button
            className={props.method === "nonlinear" ? "active" : ""}
            disabled={running || !props.nonlinearAvailable}
            title={props.nonlinearAvailable ? undefined : "Nur bei gleichem Kontrast von Datensatz und Vorlage"}
            onClick={() => props.onMethodChange("nonlinear")}
          >
            Affin + nichtlinear
          </button>
        </div>
        {props.method === "nonlinear" && props.nonlinearAvailable && (
          <label className="field">
            Regularisierung
            <select value={props.regularization} disabled={running} onChange={(e) => props.onRegularizationChange(e.target.value as Regularization)}>
              <option value="light">leicht (mehr Verformung)</option>
              <option value="medium">mittel (Standard)</option>
              <option value="heavy">stark (glatter)</option>
            </select>
          </label>
        )}
        {props.maskAvailable && (
          <label className="checkbox-field">
            <input type="checkbox" checked={props.useMask} disabled={running} onChange={(e) => props.onUseMaskChange(e.target.checked)} />
            Nur Gehirn der Vorlage verwenden (Hirnmaske)
          </label>
        )}
        {!running ? (
          <button className="primary-btn" disabled={!props.subjectId || !props.templateId} onClick={props.onStart}>
            Normalisieren und alle Datensätze übertragen
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
            {normalization.warp &&
              `; nichtlinear: max. Verschiebung ${normalization.warp.maxDisplacementMm.toFixed(1)} mm, Restfehler ${(100 * (normalization.warp.costAfter / normalization.warp.costBefore)).toFixed(0)} % des Ausgangswerts`}
          </p>
        )}
        {normalization?.warp && normalization.warp.foldedFraction > 0 && (
          <div className="error-banner">
            Verformung faltet sich in {(100 * normalization.warp.foldedFraction).toFixed(2)} % der Hirnvoxel (Jacobi-Determinante ≤ 0) – stärkere Regularisierung wählen.
          </div>
        )}
        {props.error && <div className="error-banner">{props.error}</div>}
      </Card>

      {normalization && (
        <Card
          title={<>2 · Datensätze im Standardraum</>}
          info="Alle Datensätze des Patientenraums werden über ihre Koregistrierung und die Normalisierung in den Standardraum resampelt (Labelbilder mit nächstem Nachbarn, dynamische Serien Frame für Frame) und als neue Datensätze angelegt. Eine erneute Übertragung ersetzt die älteren Kopien. Danach: Atlas-Auswertung (Centiloid & SUVR, Analyse → Label-Analyse, Kinetik) oder Export."
          status={props.transferBusy ? { text: "läuft", tone: "run" } : props.transferred.length ? { text: `✓ ${props.transferred.length}`, tone: "ok" } : null}
        >
          {props.transferred.length > 0 && (
            <ul className="plain-list">
              {props.transferred.map((t) => (
                <li key={t.id}>{t.label}</li>
              ))}
            </ul>
          )}
          <details className="kin-frames">
            <summary>Erneut übertragen / Auswahl</summary>
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
              Interpolation (Labelbilder immer nächster Nachbar)
              <select value={interp} disabled={props.transferBusy} onChange={(e) => setInterp(e.target.value as Interpolation)}>
                {(Object.keys(INTERPOLATION_LABELS) as Interpolation[]).map((m) => (
                  <option key={m} value={m}>
                    {INTERPOLATION_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary-btn" disabled={props.transferBusy || ids.length === 0} onClick={() => props.onTransfer(ids, interp)}>
              {props.transferBusy ? "Wird übertragen …" : "Übertragen"}
            </button>
          </details>
          {props.transferStatus && <p className="tool-hint">{props.transferStatus}</p>}
        </Card>
      )}
      {props.children}
    </>
  );
}
