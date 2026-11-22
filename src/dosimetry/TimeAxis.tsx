import { t } from "../i18n";
/** A point on the time axis: a measurement session (used as time point or not). */
export interface AxisPoint {
  key: string;
  /** Hours after injection (or after the first session if the injection time is unknown). */
  h: number;
  label: string;
  title: string;
  state: "ok" | "incomplete" | "unused";
  selected?: boolean;
}

const fmtH = (h: number) => (h < 10 ? h.toFixed(1).replace(".", ",") : String(Math.round(h)));

/**
 * Time axis of the dosimetry: injection at 0, measurement sessions as markers (hours p.i.). Click selects a session.
 * Without injection time the axis starts at the first session (`relative`).
 */
export function TimeAxis({ points, relative, onSelect }: { points: AxisPoint[]; relative: boolean; onSelect?: (key: string) => void }) {
  if (!points.length) return null;
  const W = 300, H = 70, L = 14, R = 16, Y = 36;
  const maxH = Math.max(...points.map((p) => p.h), relative ? 1 : 24);
  // Nice end of the axis (24 h steps up to a week, then days).
  const step = maxH <= 48 ? 12 : maxH <= 168 ? 24 : 48;
  const end = Math.ceil((maxH * 1.08) / step) * step;
  const x = (h: number) => L + ((W - L - R) * Math.max(0, h)) / end;
  const ticks = Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step);
  // Alternate labels above/below when markers are close.
  const sorted = [...points].sort((a, b) => a.h - b.h);
  const above = new Map<string, boolean>();
  sorted.forEach((p, i) => above.set(p.key, i % 2 === 0 || x(p.h) - x(sorted[i - 1].h) > 52));
  return (
    <svg className="dos-axis" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Zeitachse der Messzeitpunkte")}>
      <line x1={L} x2={W - R} y1={Y} y2={Y} className="dos-axis-line" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={Y - 3} y2={Y + 3} className="dos-axis-line" />
          <text x={x(t)} y={H - 4} className="dos-axis-tick" textAnchor="middle">
            {t === 0 ? (relative ? "0" : "Inj.") : `${t} h`}
          </text>
        </g>
      ))}
      {!relative && <line x1={x(0)} x2={x(0)} y1={Y - 12} y2={Y + 6} className="dos-axis-inj" />}
      {points.map((p) => {
        const up = above.get(p.key);
        return (
          <g key={p.key} className={`dos-axis-pt ${p.state}${p.selected ? " selected" : ""}`} onClick={() => onSelect?.(p.key)} style={{ cursor: onSelect ? "pointer" : undefined }}>
            <title>{p.title}</title>
            <circle cx={x(p.h)} cy={Y} r={p.selected ? 6.5 : 5} />
            <text x={x(p.h)} y={up ? Y - 11 : Y + 19} textAnchor="middle" className="dos-axis-label">
              {p.label} · {fmtH(p.h)} h
            </text>
          </g>
        );
      })}
    </svg>
  );
}
