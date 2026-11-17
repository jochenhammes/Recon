import { useRef, useState } from "react";
import { CALIBRATIONS, type CentiloidCalibration, type CentiloidResult } from "../centiloid/centiloid";
import { VOI_LABELS, VOI_NAMES, type VoiName } from "../centiloid/vois";
import type { Option } from "./NormalizationPanel";

export interface CentiloidOutcome {
  result: CentiloidResult;
  datasetLabel: string;
  /** e.g. "MRT-Pipeline (nichtlinear)", "PET-only", "vorhandener Datensatz". */
  pipeline: string;
  warnings: string[];
}

export interface CentiloidPanelProps {
  voisLoaded: string | null;
  onLoadVois: (files: File[]) => void;
  onShowVois: () => void;
  pets: Option[];
  defaultPetId: string | null;
  t1s: Option[];
  defaultT1Id: string | null;
  /** Whether a PET template for the PET-only pipeline is loaded. */
  petTemplateLabel: string | null;
  /** Datasets already in standard space. */
  standardTargets: Option[];
  defaultStandardId: string | null;
  running: boolean;
  status: string | null;
  onRun: (petId: string, t1Id: string | null, calibration: CentiloidCalibration) => void;
  onEvaluate: (targetId: string, calibration: CentiloidCalibration) => void;
  onCancel: () => void;
  outcome: CentiloidOutcome | null;
  error: string | null;
}

const fmt = (v: number, d = 3) => (Number.isFinite(v) ? v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");

/** Centiloid quantification of amyloid PET (Florbetaben, PiB) with the standard GAAIN VOIs. */
export function CentiloidPanel(props: CentiloidPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [calId, setCalId] = useState(CALIBRATIONS[0].id);
  const [custom, setCustom] = useState({ slope: "153.4", intercept: "-154.9", reference: "WhlCbl" as VoiName });
  const [petId, setPetId] = useState<string | null>(null);
  const [t1Id, setT1Id] = useState<string | null | undefined>(undefined);
  const [stdId, setStdId] = useState<string | null>(null);

  const calibration: CentiloidCalibration =
    calId === "custom"
      ? {
          id: "custom",
          tracer: "custom",
          label: "Eigene Gleichung",
          reference: custom.reference,
          slope: parseFloat(custom.slope.replace(",", ".")),
          intercept: parseFloat(custom.intercept.replace(",", ".")),
          window: [0, 1e6],
          source: "manuell eingegeben",
        }
      : CALIBRATIONS.find((c) => c.id === calId)!;
  const calOk = Number.isFinite(calibration.slope) && Number.isFinite(calibration.intercept);
  const pet = props.pets.find((p) => p.id === petId) ?? props.pets.find((p) => p.id === props.defaultPetId) ?? props.pets[0] ?? null;
  const t1 = t1Id === null ? null : (props.t1s.find((p) => p.id === t1Id) ?? props.t1s.find((p) => p.id === props.defaultT1Id) ?? props.t1s[0] ?? null);
  const std = props.standardTargets.find((p) => p.id === stdId) ?? props.standardTargets.find((p) => p.id === props.defaultStandardId) ?? props.standardTargets[0] ?? null;
  const canRun = !!props.voisLoaded && !!pet && calOk && (!!t1 || !!props.petTemplateLabel) && !props.running;
  const o = props.outcome;

  return (
    <section className="card">
      <h3>Centiloid</h3>
      <p className="hint">
        Amyloid-Last auf der Centiloid-Skala (0 = junge Gesunde, 100 = typische Alzheimer-Demenz): SUVR der Standard-Kortex-VOI zur Referenzregion im
        MNI-Raum, umgerechnet mit der Kalibrierung des Tracers.
      </p>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept=".zip,.nii,.gz"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) props.onLoadVois(files);
          e.target.value = "";
        }}
      />
      <div className="button-row">
        <button className="secondary-btn" onClick={() => fileInput.current?.click()}>
          {props.voisLoaded ? "VOIs ersetzen …" : "Centiloid-VOIs laden …"}
        </button>
        {props.voisLoaded && (
          <button className="secondary-btn" onClick={props.onShowVois}>
            VOIs anzeigen
          </button>
        )}
      </div>
      <p className="tool-hint">
        {props.voisLoaded ?? "Standard-VOIs von gaain.org (Centiloid Project → Centiloid_Std_VOI.zip) – die ZIP-Datei direkt auswählen. Sie werden nicht mitgeliefert (GAAIN-Nutzungsbedingungen)."}
      </p>

      <label className="field">
        Kalibrierung
        <select value={calId} onChange={(e) => setCalId(e.target.value)}>
          {CALIBRATIONS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
          <option value="custom">Eigene Gleichung …</option>
        </select>
      </label>
      {calId === "custom" ? (
        <div className="inline-fields">
          <label className="field">
            Steigung
            <input value={custom.slope} onChange={(e) => setCustom({ ...custom, slope: e.target.value })} />
          </label>
          <label className="field">
            Achsenabschnitt
            <input value={custom.intercept} onChange={(e) => setCustom({ ...custom, intercept: e.target.value })} />
          </label>
          <label className="field">
            Referenz
            <select value={custom.reference} onChange={(e) => setCustom({ ...custom, reference: e.target.value as VoiName })}>
              {VOI_NAMES.filter((n) => n !== "ctx").map((n) => (
                <option key={n} value={n}>
                  {VOI_LABELS[n]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <p className="tool-hint">
          CL = {fmt(calibration.slope, 2)} × SUVR {calibration.intercept < 0 ? "−" : "+"} {fmt(Math.abs(calibration.intercept), 2)}; Referenz:{" "}
          {VOI_LABELS[calibration.reference]}; {calibration.window[0]}–{calibration.window[1]} min p. i. – {calibration.source}
        </p>
      )}

      <h4 className="subheading">Automatisch</h4>
      <label className="field">
        PET
        <select value={pet?.id ?? ""} disabled={props.running} onChange={(e) => setPetId(e.target.value)}>
          {props.pets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        T1-MRT
        <select value={t1?.id ?? ""} disabled={props.running} onChange={(e) => setT1Id(e.target.value || null)}>
          {props.t1s.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="">ohne MRT (PET-only{props.petTemplateLabel ? `: ${props.petTemplateLabel}` : " – PET-Vorlage nötig"})</option>
        </select>
      </label>
      <p className="tool-hint">
        {t1
          ? "PET → T1 rigide (NMI), T1 → MNI affin + nichtlinear, PET über beide Schritte in den MNI-Raum, dann VOI-Auswertung."
          : props.petTemplateLabel
            ? "PET direkt affin + nichtlinear auf die PET-Vorlage, dann VOI-Auswertung."
            : "Für PET-only zuerst eine Florbetaben-Vorlage laden (Panel „Daten“ → Standardraum-Vorlage, Kontrast PET)."}
      </p>
      {!props.running ? (
        <button className="primary-btn" disabled={!canRun} onClick={() => pet && props.onRun(pet.id, t1?.id ?? null, calibration)}>
          Centiloid bestimmen
        </button>
      ) : (
        <button className="secondary-btn" onClick={props.onCancel}>
          Abbrechen
        </button>
      )}
      {props.status && <p className="tool-hint">{props.status}</p>}

      {props.standardTargets.length > 0 && (
        <>
          <h4 className="subheading">Vorhandenen Datensatz im MNI-Raum auswerten</h4>
          <label className="field">
            Datensatz
            <select value={std?.id ?? ""} disabled={props.running} onChange={(e) => setStdId(e.target.value)}>
              {props.standardTargets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-btn" disabled={!props.voisLoaded || !std || !calOk || props.running} onClick={() => std && props.onEvaluate(std.id, calibration)}>
            Auswerten
          </button>
        </>
      )}

      {props.error && <div className="error-banner">{props.error}</div>}

      {o && (
        <div className="centiloid-result">
          <div className="centiloid-value">
            <span className="centiloid-number">{fmt(o.result.centiloid, 1)}</span>
            <span className="centiloid-unit">CL</span>
          </div>
          <p className="tool-hint">
            {o.datasetLabel} · {o.pipeline} · {o.result.calibration.label}
          </p>
          {o.warnings.map((w) => (
            <div key={w} className="warning-banner">
              {w}
            </div>
          ))}
          <table className="region-table">
            <thead>
              <tr>
                <th>VOI</th>
                <th>ml</th>
                <th>Mittel</th>
                <th>SUVR</th>
              </tr>
            </thead>
            <tbody>
              {o.result.means.map((m) => (
                <tr key={m.name} className={m.name === o.result.calibration.reference ? "reference-row" : undefined}>
                  <td>{VOI_LABELS[m.name]}</td>
                  <td>{fmt(m.volumeMl, 0)}</td>
                  <td>{fmt(m.mean, Math.abs(m.mean) >= 100 ? 0 : 3)}</td>
                  <td>{m.name === "ctx" ? "" : fmt(o.result.suvr[m.name] ?? NaN)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tool-hint">SUVR = Kortex / Referenz; markiert ist die Referenz der Kalibrierung.</p>
        </div>
      )}
    </section>
  );
}
