import { COST_LABELS, type CostName } from "../registration/cost";

import { t, tk } from "../i18n";
export type CostChoice = CostName | "auto";

export interface CoregSettings {
  dof: 6 | 12;
  cost: CostChoice;
  levels: number[];
  coarseSearch: boolean;
  /** Coarse search only around the start position (e.g. after landmark alignment). */
  keepStart?: boolean;
}

const LEVEL_PRESETS: { label: string; levels: number[] }[] = [
  { label: tk("Standard (8 → 4 → 2 mm)"), levels: [8, 4, 2] },
  { label: tk("Schnell (8 → 4 mm)"), levels: [8, 4] },
  { label: tk("Fein (8 → 4 → 2 → 1 mm)"), levels: [8, 4, 2, 1] },
];

export interface CoregSettingsFormProps {
  /** Cost used when "auto" is selected (depends on the modality pair). */
  autoCost: CostName;
  settings: CoregSettings;
  onSettingsChange: (s: CoregSettings) => void;
  running: boolean;
}

/** Registration settings (degrees of freedom, cost, levels, coarse search). */
export function CoregSettingsForm(props: CoregSettingsFormProps) {
  const { settings, running } = props;
  const set = (patch: Partial<CoregSettings>) => props.onSettingsChange({ ...settings, ...patch });
  const preset = LEVEL_PRESETS.findIndex((p) => p.levels.join() === settings.levels.join());
  return (
    <>
      <div className="segmented-control" role="group" aria-label={t("Freiheitsgrade")}>
        <button className={settings.dof === 6 ? "active" : ""} disabled={running} onClick={() => set({ dof: 6 })}>
          {t("Rigide (6)")}
        </button>
        <button className={settings.dof === 12 ? "active" : ""} disabled={running} onClick={() => set({ dof: 12 })}>
          {t("Affin (12)")}
        </button>
      </div>
      <div className="field-row">
        <label className="field">
          {t("Kostenfunktion")}
          <select value={settings.cost} disabled={running} onChange={(e) => set({ cost: e.target.value as CostChoice })}>
            <option value="auto">{t("Automatisch ({cost})", { cost: t(COST_LABELS[props.autoCost]).split(" (")[0] })}</option>
            {(Object.keys(COST_LABELS) as CostName[]).map((c) => (
              <option key={c} value={c}>
                {t(COST_LABELS[c])}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t("Auflösungsstufen")}
          <select value={preset} disabled={running} onChange={(e) => set({ levels: LEVEL_PRESETS[Number(e.target.value)].levels })}>
            {LEVEL_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {t(p.label)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="checkbox-field">
        <input type="checkbox" checked={settings.coarseSearch} disabled={running} onChange={(e) => set({ coarseSearch: e.target.checked })} />
        <span title={t("Schwerpunkt-Ausrichtung plus Rotationsraster ±30° auf der gröbsten Stufe – für Daten aus verschiedenen Untersuchungen")}>{t("Grobsuche")}</span>
      </label>
      {settings.coarseSearch && (
        <label className="checkbox-field">
          <input type="checkbox" checked={!!settings.keepStart} disabled={running} onChange={(e) => set({ keepStart: e.target.checked })} />
          <span title={t("Nach Landmarken-Ausrichtung: nur ±10° / ±10 mm um die aktuelle Lage suchen, kein Sprung auf den Schwerpunkt")}>{t("Startlage beibehalten")}</span>
        </label>
      )}
    </>
  );
}
