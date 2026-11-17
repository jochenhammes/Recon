import { useMemo } from "react";
import type { VolumeStats } from "../analysis/stats";
import { type EditOp, countAffected, describeEdit } from "../edit/operations";
import type { Volume3D } from "../viewer/volume";
import { formatCount, parseInput } from "./format";

/** Above this fraction of affected voxels the user must confirm the edit. */
const LARGE_EDIT_FRACTION = 0.01;

export interface EditPanelProps {
  volume: Volume3D;
  stats: VolumeStats;
  edits: EditOp[];
  /** Inputs are in display units: display = raw × scale. */
  scale: number;
  unitLabel: string;
  threshold: string;
  onThresholdChange: (value: string) => void;
  value: string;
  onValueChange: (value: string) => void;
  onApply: (op: EditOp) => void;
  onUndo: () => void;
  onReset: () => void;
}

export function EditPanel(props: EditPanelProps) {
  const { volume, stats, edits, scale, unitLabel, threshold, onThresholdChange, value, onValueChange, onApply, onUndo, onReset } = props;
  // Inputs are in display units; edits always operate on raw (stored real) values.
  const rawThreshold = parseInput(threshold) / scale;
  const rawValue = parseInput(value) / scale;
  const valid = Number.isFinite(rawThreshold) && Number.isFinite(rawValue);

  const affected = useMemo(
    () => (valid ? countAffected(volume, { type: "thresholdReplace", threshold: rawThreshold, value: rawValue }) : 0),
    [volume, valid, rawThreshold, rawValue],
  );
  const fraction = affected / Math.max(stats.count, 1);
  const percent = (fraction * 100).toLocaleString("de-DE", { maximumFractionDigits: 2 });
  const large = fraction > LARGE_EDIT_FRACTION;

  const sliderMin = Number.isFinite(stats.min) ? stats.min * scale : 0;
  const sliderMax = Number.isFinite(stats.max) ? stats.max * scale : 1;
  const sliderStep = (sliderMax - sliderMin) / 1000 || 1;
  const displayThreshold = parseInput(threshold);
  const unit = unitLabel ? ` (${unitLabel})` : "";

  function apply() {
    if (!valid) return;
    if (
      large &&
      !window.confirm(
        `Achtung: ${formatCount(affected)} Voxel (${percent} % des Datensatzes) wären betroffen.\n\n` +
          "Zum Kappen eines Hotspots ist das ungewöhnlich viel – stimmen Grenzwert und Einheit?\n\nTrotzdem anwenden?",
      )
    )
      return;
    onApply({ type: "thresholdReplace", threshold: rawThreshold, value: rawValue });
  }

  return (
    <div className="tool-panel">
      <h2>Bearbeiten</h2>
      <p className="tool-hint">Alle Bildpunkte mit Wert ≥ Grenzwert im gesamten 3D-Datensatz auf einen festen Wert setzen.</p>
      <label className="field">
        Grenzwert (≥){unit}
        <input type="text" inputMode="decimal" value={threshold} onChange={(e) => onThresholdChange(e.target.value)} />
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={sliderStep}
          value={Number.isFinite(displayThreshold) ? Math.min(Math.max(displayThreshold, sliderMin), sliderMax) : sliderMax}
          onChange={(e) => onThresholdChange(e.target.value)}
          aria-label="Grenzwert"
        />
      </label>
      <label className="field">
        Neuer Wert{unit}
        <input type="text" inputMode="decimal" value={value} onChange={(e) => onValueChange(e.target.value)} />
      </label>
      <p className={large ? "tool-hint tool-warning" : "tool-hint"}>
        {valid
          ? `Betroffen: ${formatCount(affected)} Voxel (${percent} %)` +
            (large ? " – ungewöhnlich viel, bitte Grenzwert und Einheit prüfen." : "")
          : "Bitte gültige Zahlen eingeben."}
      </p>
      <button className="primary-btn" disabled={!valid || affected === 0} onClick={apply}>
        Anwenden
      </button>
      <div className="button-row">
        <button className="secondary-btn" disabled={edits.length === 0} onClick={onUndo}>
          Rückgängig
        </button>
        <button className="secondary-btn" disabled={edits.length === 0} onClick={onReset}>
          Original
        </button>
      </div>
      {edits.length > 0 && (
        <ol className="edit-history">
          {edits.map((e, i) => (
            <li key={i}>{describeEdit(e, { scale, label: unitLabel })}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
