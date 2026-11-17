import { useRef, useState } from "react";
import { COST_LABELS, type CostName } from "../registration/cost";

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
  /** Dataset the transformation tools act on (selected in the list). */
  focusLabel: string | null;
  /** Cost used when "auto" is selected (depends on the modality pair). */
  autoCost: CostName;
  settings: CoregSettings;
  onSettingsChange: (s: CoregSettings) => void;
  running: boolean;
  onResetToScanner: () => void;
  onSaveMatrix: () => void;
  onLoadMatrix: (file: File) => void;
  frameNote?: string;
  error?: string | null;
}


export function CoregPanel(props: CoregPanelProps) {
  const { settings, running } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [showHelp, setShowHelp] = useState(false);
  const set = (patch: Partial<CoregSettings>) => props.onSettingsChange({ ...settings, ...patch });
  const preset = LEVEL_PRESETS.findIndex((p) => p.levels.join() === settings.levels.join());

  return (
    <section className="card">
      <h3>3 · Einstellungen</h3>
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
      {props.error && <div className="error-banner">{props.error}</div>}
      <h3>Transformation{props.focusLabel ? `: ${props.focusLabel}` : ""}</h3>
      <div className="button-row">
        <button className="secondary-btn" disabled={running || !props.focusLabel} onClick={props.onSaveMatrix}>
          Matrix speichern
        </button>
        <button className="secondary-btn" disabled={running || !props.focusLabel} onClick={() => fileRef.current?.click()}>
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
      <button className="secondary-btn" disabled={running || !props.focusLabel} onClick={props.onResetToScanner}>
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
