import type { VolumeStats } from "../analysis/stats";
import type { SuvResult } from "../analysis/suv";
import type { Volume3D } from "../viewer/volume";
import { Histogram } from "./Histogram";
import { InfoText } from "../ui/Info";
import { type UnitMode, formatCount, formatValue } from "./format";

import { t } from "../i18n";
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
              <option value="raw">{t("Originalwerte")}</option>
              <option value="suv">{t("SUV (Körpergewicht)")}</option>
            </select>
          </label>
          {suv.ok ? (
            <InfoText
              details={
                t("SUV 1 ≙ {v} Bq/ml · Körpergewicht {v2} kg · ", { v: formatValue(1 / suv.info.factor), v2: formatValue(suv.info.weightKg) }) +
                t("{v} MBq injiziert, ", { v: formatValue(suv.info.injectedDoseBq / 1e6) }) +
                (suv.info.decayCorrection === "START"
                  ? t("{v} MBq bei Serienstart (+{v2} min).", { v: formatValue(suv.info.doseAtReferenceBq / 1e6), v2: formatValue(Math.round(suv.info.minutesToReference)) })
                  : t("Zerfallskorrektur auf Injektionszeit."))
              }
            >
              {t("SUV verfügbar")}
            </InfoText>
          ) : (
            <InfoText details={t("SUV nicht verfügbar: {reason}", { reason: suv.reason })}>{t("SUV nicht verfügbar")}</InfoText>
          )}
        </div>
      )}
      <dl className="summary-list">
        <dt>{t("Bildpunkte")}</dt>
        <dd>{formatCount(stats.count)}</dd>
        <dt>{t("Matrix (x×y×z)")}</dt>
        <dd>
          {volume.nx}×{volume.ny}×{volume.nz}
        </dd>
        <dt>{t("Minimum")}</dt>
        <dd>{v(stats.min)}</dd>
        <dt>{t("Mittelwert")}</dt>
        <dd>{v(stats.mean)}</dd>
        <dt>{t("Median")}</dt>
        <dd>{v(stats.median)}</dd>
        <dt>{t("Maximum")}</dt>
        <dd>{v(stats.max)}</dd>
        <dt>{t("Standardabweichung")}</dt>
        <dd>{v(stats.sd)}</dd>
        <dt>{t("Varianz")}</dt>
        <dd>{formatValue(stats.variance * scale * scale) + (unitLabel ? ` ${unitLabel}²` : "")}</dd>
        {stats.nonFinite > 0 && (
          <>
            <dt>{t("Ungültig (NaN/∞)")}</dt>
            <dd>{formatCount(stats.nonFinite)}</dd>
          </>
        )}
      </dl>
      <Histogram data={volume.data} marker={marker} scale={scale} />
    </div>
  );
}
