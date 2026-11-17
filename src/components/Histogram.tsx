import { useMemo, useState } from "react";
import { computeHistogram } from "../analysis/stats";
import { formatCount, formatValue } from "./format";

export interface HistogramProps {
  data: Float32Array;
  /** Optional value to mark with a vertical line (e.g. the edit threshold). */
  marker?: number;
}

const WIDTH = 300;
const HEIGHT = 150;
const PAD_LEFT = 4;
const PAD_RIGHT = 4;
const PAD_TOP = 6;
const PAD_BOTTOM = 18;

export function Histogram({ data, marker }: HistogramProps) {
  const [bins, setBins] = useState(128);
  const [logScale, setLogScale] = useState(true);
  const [excludeZero, setExcludeZero] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const hist = useMemo(() => computeHistogram(data, { bins, excludeZero }), [data, bins, excludeZero]);
  const lo = hist.edges[0];
  const hi = hist.edges[hist.edges.length - 1];
  const plotW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  let maxCount = 0;
  for (const c of hist.counts) if (c > maxCount) maxCount = c;
  const scale = (c: number) => {
    if (c <= 0 || maxCount <= 0) return 0;
    return logScale ? Math.log10(c + 1) / Math.log10(maxCount + 1) : c / maxCount;
  };
  const barW = plotW / hist.counts.length;
  const xOf = (v: number) => PAD_LEFT + ((v - lo) / (hi - lo)) * plotW;

  const hovered = hover !== null && hover < hist.counts.length ? hover : null;

  return (
    <div className="histogram">
      <div className="histogram-controls">
        <label>
          Bins{" "}
          <select value={bins} onChange={(e) => setBins(Number(e.target.value))}>
            {[32, 64, 128, 256].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} /> log
        </label>
        <label>
          <input type="checkbox" checked={excludeZero} onChange={(e) => setExcludeZero(e.target.checked)} /> ohne 0
        </label>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="histogram-svg"
        role="img"
        aria-label="Histogramm der Werteverteilung"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * WIDTH - PAD_LEFT;
          const b = Math.floor(x / barW);
          setHover(b >= 0 && b < hist.counts.length ? b : null);
        }}
      >
        <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={PAD_TOP + plotH} y2={PAD_TOP + plotH} className="histogram-axis" />
        {Array.from(hist.counts, (c, i) => {
          const h = scale(c) * plotH;
          if (h <= 0) return null;
          return (
            <rect
              key={i}
              x={PAD_LEFT + i * barW}
              y={PAD_TOP + plotH - h}
              width={Math.max(barW - (barW > 3 ? 1 : 0), 0.5)}
              height={h}
              className={i === hovered ? "histogram-bar hovered" : "histogram-bar"}
            />
          );
        })}
        {marker !== undefined && Number.isFinite(marker) && marker >= lo && marker <= hi && (
          <line x1={xOf(marker)} x2={xOf(marker)} y1={PAD_TOP} y2={PAD_TOP + plotH} className="histogram-marker" />
        )}
        <text x={PAD_LEFT} y={HEIGHT - 4} className="histogram-label" textAnchor="start">
          {formatValue(lo)}
        </text>
        <text x={WIDTH - PAD_RIGHT} y={HEIGHT - 4} className="histogram-label" textAnchor="end">
          {formatValue(hi)}
        </text>
      </svg>
      <div className="histogram-readout">
        {hovered !== null
          ? `[${formatValue(hist.edges[hovered])} … ${formatValue(hist.edges[hovered + 1])}${hovered === hist.counts.length - 1 ? "]" : ")"}: ${formatCount(hist.counts[hovered])} Voxel`
          : `max. ${formatCount(maxCount)} Voxel pro Bin${logScale ? " (log. Skala)" : ""}`}
      </div>
    </div>
  );
}
