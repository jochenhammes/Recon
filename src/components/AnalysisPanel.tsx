import type { VolumeStats } from "../analysis/stats";
import type { Volume3D } from "../viewer/volume";
import { Histogram } from "./Histogram";
import { formatCount, formatValue } from "./format";

export interface AnalysisPanelProps {
  volume: Volume3D;
  stats: VolumeStats;
  /** Current edit threshold, drawn as a marker in the histogram. */
  marker?: number;
}

export function AnalysisPanel({ volume, stats, marker }: AnalysisPanelProps) {
  return (
    <div className="tool-panel">
      <h2>Analyse</h2>
      <dl className="summary-list">
        <dt>Bildpunkte</dt>
        <dd>{formatCount(stats.count)}</dd>
        <dt>Matrix (x×y×z)</dt>
        <dd>
          {volume.nx}×{volume.ny}×{volume.nz}
        </dd>
        <dt>Minimum</dt>
        <dd>{formatValue(stats.min)}</dd>
        <dt>Mittelwert</dt>
        <dd>{formatValue(stats.mean)}</dd>
        <dt>Median</dt>
        <dd>{formatValue(stats.median)}</dd>
        <dt>Maximum</dt>
        <dd>{formatValue(stats.max)}</dd>
        {stats.nonFinite > 0 && (
          <>
            <dt>Ungültig (NaN/∞)</dt>
            <dd>{formatCount(stats.nonFinite)}</dd>
          </>
        )}
      </dl>
      <Histogram data={volume.data} marker={marker} />
    </div>
  );
}
