import { useMemo, useState } from "react";
import type { VolumeStats } from "../analysis/stats";
import { type EditOp, countAffected, describeEdit } from "../edit/operations";
import type { Volume3D } from "../viewer/volume";
import { formatCount } from "./format";

export interface EditPanelProps {
  volume: Volume3D;
  stats: VolumeStats;
  edits: EditOp[];
  threshold: string;
  onThresholdChange: (value: string) => void;
  onApply: (op: EditOp) => void;
  onUndo: () => void;
  onReset: () => void;
}

function parseNumber(s: string): number {
  const v = Number(s.trim().replace(",", "."));
  return s.trim() === "" ? NaN : v;
}

export function EditPanel({ volume, stats, edits, threshold, onThresholdChange, onApply, onUndo, onReset }: EditPanelProps) {
  const [value, setValue] = useState("0");
  const thresholdNum = parseNumber(threshold);
  const valueNum = parseNumber(value);
  const valid = Number.isFinite(thresholdNum) && Number.isFinite(valueNum);
  const op: EditOp | null = valid ? { type: "thresholdReplace", threshold: thresholdNum, value: valueNum } : null;

  const affected = useMemo(
    () => (valid ? countAffected(volume, { type: "thresholdReplace", threshold: thresholdNum, value: valueNum }) : 0),
    [volume, valid, thresholdNum, valueNum],
  );
  const sliderMin = Number.isFinite(stats.min) ? stats.min : 0;
  const sliderMax = Number.isFinite(stats.max) ? stats.max : 1;
  const sliderStep = (sliderMax - sliderMin) / 1000 || 1;

  return (
    <div className="tool-panel">
      <h2>Bearbeiten</h2>
      <p className="tool-hint">Alle Bildpunkte mit Wert ≥ Grenzwert im gesamten 3D-Datensatz auf einen festen Wert setzen.</p>
      <label className="field">
        Grenzwert (≥)
        <input type="text" inputMode="decimal" value={threshold} onChange={(e) => onThresholdChange(e.target.value)} />
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={sliderStep}
          value={Number.isFinite(thresholdNum) ? Math.min(Math.max(thresholdNum, sliderMin), sliderMax) : sliderMax}
          onChange={(e) => onThresholdChange(e.target.value)}
          aria-label="Grenzwert"
        />
      </label>
      <label className="field">
        Neuer Wert
        <input type="text" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <p className="tool-hint">
        {valid
          ? `Betroffen: ${formatCount(affected)} Voxel (${((affected / Math.max(stats.count, 1)) * 100).toLocaleString("de-DE", { maximumFractionDigits: 2 })} %)`
          : "Bitte gültige Zahlen eingeben."}
      </p>
      <button className="primary-btn" disabled={!op || affected === 0} onClick={() => op && onApply(op)}>
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
            <li key={i}>{describeEdit(e)}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
