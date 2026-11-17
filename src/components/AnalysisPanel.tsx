import type { VolumeStats } from "../analysis/stats";
import type { SuvResult } from "../analysis/suv";
import type { Volume3D } from "../viewer/volume";
import { Histogram } from "./Histogram";
import { type UnitMode, formatCount, formatValue } from "./format";

export interface AnalysisPanelProps {
  volume: Volume3D;
  stats: VolumeStats;
  /** Current edit threshold in raw units, drawn as a marker in the histogram. */
  marker?: number;
  /** Display value = raw value × scale (SUV factor or 1). */
  scale: number;
  unitLabel: string;
  unitMode: UnitMode;
  /** SUV availability for the loaded data (null if not a DICOM source). */
  suv: SuvResult | null;
  onUnitModeChange: (mode: UnitMode) => void;
}

export function AnalysisPanel({ volume, stats, marker, scale, unitLabel, unitMode, suv, onUnitModeChange }: AnalysisPanelProps) {
  const v = (x: number) => formatValue(x * scale) + (unitLabel ? ` ${unitLabel}` : "");
  return (
    <div className="tool-panel">
      {suv && (
        <div className="unit-switch">
          <label>
            Einheit{" "}
            <select value={unitMode} onChange={(e) => onUnitModeChange(e.target.value as UnitMode)} disabled={!suv.ok}>
              <option value="raw">Originalwerte</option>
              <option value="suv">SUV (Körpergewicht)</option>
            </select>
          </label>
          <p className="tool-hint">
            {suv.ok
              ? `SUV 1 ≙ ${formatValue(1 / suv.info.factor)} Bq/ml · ${formatValue(suv.info.weightKg)} kg · ` +
                `${formatValue(suv.info.injectedDoseBq / 1e6)} MBq injiziert, ` +
                (suv.info.decayCorrection === "START"
                  ? `${formatValue(suv.info.doseAtReferenceBq / 1e6)} MBq bei Serienstart (+${formatValue(Math.round(suv.info.minutesToReference))} min)`
                  : "Zerfallskorrektur auf Injektionszeit")
              : `SUV nicht verfügbar: ${suv.reason}`}
          </p>
        </div>
      )}
      <dl className="summary-list">
        <dt>Bildpunkte</dt>
        <dd>{formatCount(stats.count)}</dd>
        <dt>Matrix (x×y×z)</dt>
        <dd>
          {volume.nx}×{volume.ny}×{volume.nz}
        </dd>
        <dt>Minimum</dt>
        <dd>{v(stats.min)}</dd>
        <dt>Mittelwert</dt>
        <dd>{v(stats.mean)}</dd>
        <dt>Median</dt>
        <dd>{v(stats.median)}</dd>
        <dt>Maximum</dt>
        <dd>{v(stats.max)}</dd>
        <dt>Standardabweichung</dt>
        <dd>{v(stats.sd)}</dd>
        <dt>Varianz</dt>
        <dd>{formatValue(stats.variance * scale * scale) + (unitLabel ? ` ${unitLabel}²` : "")}</dd>
        {stats.nonFinite > 0 && (
          <>
            <dt>Ungültig (NaN/∞)</dt>
            <dd>{formatCount(stats.nonFinite)}</dd>
          </>
        )}
      </dl>
      <Histogram data={volume.data} marker={marker} scale={scale} />
    </div>
  );
}
