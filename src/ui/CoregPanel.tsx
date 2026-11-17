import { useRef, useState } from "react";
import { COST_LABELS, type CostName } from "../registration/cost";
import type { CoregProgress, CoregResult } from "../registration/coregister";

export type CostChoice = CostName | "auto";

export interface CoregSettings {
  dof: 6 | 12;
  cost: CostChoice;
  levels: number[];
  coarseSearch: boolean;
}

const LEVEL_PRESETS: { label: string; levels: number[] }[] = [
  { label: "Standard (8 → 4 → 2 mm)", levels: [8, 4, 2] },
  { label: "Schnell (8 → 4 mm)", levels: [8, 4] },
  { label: "Fein (8 → 4 → 2 → 1 mm)", levels: [8, 4, 2, 1] },
];

export interface CoregPanelProps {
  movingOptions: { id: string; label: string }[];
  movingId: string | null;
  onMovingChange: (id: string) => void;
  referenceLabel: string;
  /** Cost used when "auto" is selected (depends on the modality pair). */
  autoCost: CostName;
  settings: CoregSettings;
  onSettingsChange: (s: CoregSettings) => void;
  running: boolean;
  progress: CoregProgress | null;
  onStart: () => void;
  onCancel: () => void;
  /** Last result awaiting confirmation. */
  pending: CoregResult | null;
  onAccept: () => void;
  onDiscard: () => void;
  onResetToScanner: () => void;
  onSaveMatrix: () => void;
  onLoadMatrix: (file: File) => void;
  frameNote?: string;
  error?: string | null;
}

/** Converts a cost value (lower is better) to the displayed similarity. */
function similarity(cost: CostName, v: number): string {
  if (!Number.isFinite(v)) return "–";
  if (v >= 10) return "keine Überlappung";
  if (cost === "cr") return `CR ${(1 - v).toFixed(4)}`;
  if (cost === "ncc") return `NCC ${(-v).toFixed(4)}`;
  return `${cost.toUpperCase()} ${(-v).toFixed(4)}`;
}

export function CoregPanel(props: CoregPanelProps) {
  const { settings, running, progress, pending } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [showHelp, setShowHelp] = useState(false);
  const set = (patch: Partial<CoregSettings>) => props.onSettingsChange({ ...settings, ...patch });
  const effectiveCost = settings.cost === "auto" ? props.autoCost : settings.cost;
  const preset = LEVEL_PRESETS.findIndex((p) => p.levels.join() === settings.levels.join());

  return (
    <section className="card">
      <h3>Automatische Coregistrierung</h3>
      <label className="field">
        Bewegter Datensatz → Referenz ({props.referenceLabel})
        <select value={props.movingId ?? ""} disabled={running} onChange={(e) => props.onMovingChange(e.target.value)}>
          {props.movingOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {props.frameNote && <p className="hint">{props.frameNote}</p>}
      <div className="segmented-control" role="group" aria-label="Freiheitsgrade">
        <button className={settings.dof === 6 ? "active" : ""} disabled={running} onClick={() => set({ dof: 6 })}>
          Rigide (6)
        </button>
        <button className={settings.dof === 12 ? "active" : ""} disabled={running} onClick={() => set({ dof: 12 })}>
          Affin (12)
        </button>
      </div>
      <label className="field">
        Kostenfunktion
        <select value={settings.cost} disabled={running} onChange={(e) => set({ cost: e.target.value as CostChoice })}>
          <option value="auto">Automatisch ({COST_LABELS[props.autoCost].split(" (")[0]})</option>
          {(Object.keys(COST_LABELS) as CostName[]).map((c) => (
            <option key={c} value={c}>
              {COST_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Auflösungsstufen
        <select value={preset} disabled={running} onChange={(e) => set({ levels: LEVEL_PRESETS[Number(e.target.value)].levels })}>
          {LEVEL_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-field">
        <input type="checkbox" checked={settings.coarseSearch} disabled={running} onChange={(e) => set({ coarseSearch: e.target.checked })} />
        Grobsuche (Schwerpunkt + Rotationsraster ±30°) – für Daten aus verschiedenen Untersuchungen
      </label>
      {!running ? (
        <button className="primary-btn" disabled={!props.movingId || !!pending} onClick={props.onStart}>
          Coregistrierung starten
        </button>
      ) : (
        <>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${progress ? Math.round(((progress.level - 1) / progress.levels) * 100 + 100 / progress.levels / 2) : 3}%` }} />
          </div>
          <p className="tool-hint">
            {progress
              ? `Stufe ${progress.level}/${progress.levels} · ${progress.stage} · Iteration ${progress.iteration + 1} · ${similarity(effectiveCost, progress.cost)}`
              : "Vorbereitung …"}
          </p>
          <button className="secondary-btn" onClick={props.onCancel}>
            Abbrechen
          </button>
        </>
      )}
      {pending && (
        <div className="coreg-result">
          <p className="tool-hint">
            Ergebnis ({pending.evaluations} Auswertungen): {similarity(pending.cost, pending.before)} → <strong>{similarity(pending.cost, pending.after)}</strong>
          </p>
          <p className="tool-hint">
            Verschiebung {[pending.params.tx, pending.params.ty, pending.params.tz].map((v) => v.toFixed(1)).join(" / ")} mm · Drehung{" "}
            {[pending.params.rx, pending.params.ry, pending.params.rz].map((v) => v.toFixed(2)).join(" / ")}°
            {settings.dof === 12 && ` · Skalierung ${[pending.params.sx, pending.params.sy, pending.params.sz].map((v) => v.toFixed(3)).join(" / ")}`}
          </p>
          <p className="tool-hint">Die Ansicht zeigt bereits das Ergebnis – bitte visuell prüfen.</p>
          <div className="button-row">
            <button className="secondary-btn toggled" onClick={props.onAccept}>
              Übernehmen
            </button>
            <button className="secondary-btn" onClick={props.onDiscard}>
              Verwerfen
            </button>
          </div>
        </div>
      )}
      {props.error && <div className="error-banner">{props.error}</div>}
      <h3>Transformation</h3>
      <div className="button-row">
        <button className="secondary-btn" disabled={running || !props.movingId} onClick={props.onSaveMatrix}>
          Matrix speichern
        </button>
        <button className="secondary-btn" disabled={running || !props.movingId} onClick={() => fileRef.current?.click()}>
          Matrix laden
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) props.onLoadMatrix(f);
          e.target.value = "";
        }}
      />
      <button className="secondary-btn" disabled={running || !props.movingId} onClick={props.onResetToScanner}>
        Auf Patientenkoordinaten zurücksetzen
      </button>
      <button className="link-btn" onClick={() => setShowHelp((v) => !v)}>
        {showHelp ? "Hinweise ausblenden" : "Wie funktioniert die Coregistrierung?"}
      </button>
      {showHelp && (
        <p className="tool-hint">
          Intensitätsbasierte Registrierung nach dem Vorbild von SPM (Coregister) und FSL FLIRT: Beide Datensätze werden
          robust skaliert, je Auflösungsstufe geglättet und auf einem Gitter abgetastet. Das Powell-Verfahren sucht die
          Transformation, die das Ähnlichkeitsmaß maximiert – Mutual Information für unterschiedliche Modalitäten
          (PET/CT, PET/MRT), Kreuzkorrelation für gleiche (PET/PET). Startpunkt ist die aktuelle Ausrichtung
          (Patientenkoordinaten bzw. manuelle Korrektur). Rigide = Verschiebung und Drehung, affin zusätzlich Skalierung
          und Scherung.
        </p>
      )}
    </section>
  );
}
