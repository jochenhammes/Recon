import { formatValue } from "../components/format";

export interface ChartSeries {
  label: string;
  x: number[];
  y: number[];
  /** "points" (markers), "line" or both. */
  style: "points" | "line" | "both";
  color: string;
}

const W = 300, H = 170, PL = 44, PR = 10, PT = 8, PB = 28;

/** Minimal SVG x/y chart (TACs, Patlak plot); axes start at 0 unless data are negative. */
export function Chart({ series, xLabel, yLabel }: { series: ChartSeries[]; xLabel: string; yLabel: string }) {
  const xs = series.flatMap((s) => s.x).filter(Number.isFinite);
  const ys = series.flatMap((s) => s.y).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  const x0 = Math.min(0, ...xs), x1 = Math.max(...xs) || 1;
  const y0 = Math.min(0, ...ys), y1 = Math.max(...ys) * 1.05 || 1;
  const px = (x: number) => PL + ((x - x0) / (x1 - x0 || 1)) * (W - PL - PR);
  const py = (y: number) => PT + (1 - (y - y0) / (y1 - y0 || 1)) * (H - PT - PB);
  const ticks = (a: number, b: number) => [0, 0.5, 1].map((f) => a + f * (b - a));
  return (
    <div className="kin-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} über ${xLabel}`}>
        <line x1={PL} x2={W - PR} y1={py(y0)} y2={py(y0)} className="kin-axis" />
        <line x1={PL} x2={PL} y1={PT} y2={H - PB} className="kin-axis" />
        {ticks(x0, x1).map((t) => (
          <text key={`x${t}`} x={px(t)} y={H - PB + 12} className="kin-tick" textAnchor="middle">
            {formatValue(t)}
          </text>
        ))}
        {ticks(y0, y1).map((t) => (
          <text key={`y${t}`} x={PL - 4} y={py(t) + 3} className="kin-tick" textAnchor="end">
            {formatValue(t)}
          </text>
        ))}
        <text x={(PL + W - PR) / 2} y={H - 2} className="kin-tick" textAnchor="middle">
          {xLabel}
        </text>
        {[...series].sort((a, b) => Number(a.style === "points") - Number(b.style === "points")).map((s) => (
          <g key={s.label}>
            {s.style !== "points" && (
              <polyline
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                points={s.x.map((x, i) => (Number.isFinite(s.y[i]) ? `${px(x)},${py(s.y[i])}` : "")).filter(Boolean).join(" ")}
              />
            )}
            {s.style !== "line" && s.x.map((x, i) => (Number.isFinite(s.y[i]) ? <circle key={i} cx={px(x)} cy={py(s.y[i])} r={2.2} fill={s.color} /> : null))}
          </g>
        ))}
      </svg>
      <div className="kin-legend">
        <span className="kin-ylabel">{yLabel}</span>
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
