import { IDENTITY_PARAMS, type TransformParams } from "../core/transform";

const TRANSLATIONS: [keyof TransformParams, string][] = [
  ["tx", "Rechts ↔ Links (x)"],
  ["ty", "Anterior ↔ Posterior (y)"],
  ["tz", "Fuß ↔ Kopf (z)"],
];
const ROTATIONS: [keyof TransformParams, string][] = [
  ["rx", "Kippen (um x)"],
  ["ry", "Neigen (um y)"],
  ["rz", "Drehen (um z)"],
];

export interface RegistrationPanelProps {
  params: TransformParams;
  onChange: (p: TransformParams) => void;
  /** Warning if the frames of reference differ / are unknown. */
  frameNote?: string;
  title: string;
  /** Affine parameters (scale/shear) present: show them read-only. */
  children?: React.ReactNode;
  /** Rotation center choices (e.g. volume center, landmark); the parameters refer to the chosen one. */
  pivots?: { id: string; label: string }[];
  pivot?: string;
  onPivotChange?: (id: string) => void;
}

/** Manual rigid fine registration of the functional layer relative to the CT. */
export function RegistrationPanel({ params, onChange, frameNote, title, children, pivots, pivot, onPivotChange }: RegistrationPanelProps) {
  const turn = (key: "rx" | "ry" | "rz", deg: number) => onChange({ ...params, [key]: normAngle(params[key] + deg) });
  const row = (key: keyof TransformParams, label: string, range: number, step: number, unit: string) => (
    <label key={key} className="field slider-field">
      <span className="slider-label">
        {label}
        <span className="slider-value">
          <button className="step-btn" aria-label={`${label} verringern`} onClick={() => onChange({ ...params, [key]: round(params[key] - step) })}>
            −
          </button>
          {params[key].toFixed(step < 1 ? 1 : 0)} {unit}
          <button className="step-btn" aria-label={`${label} erhöhen`} onClick={() => onChange({ ...params, [key]: round(params[key] + step) })}>
            +
          </button>
        </span>
      </span>
      <input
        type="range"
        min={-range}
        max={range}
        step={step}
        value={params[key]}
        onChange={(e) => onChange({ ...params, [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <section className="card">
      <h3>{title}</h3>
      {frameNote && <p className="hint">{frameNote}</p>}
      {TRANSLATIONS.map(([k, l]) => row(k, l, Math.max(60, Math.ceil(Math.abs(params[k]) / 20) * 20 + 20), 0.5, "mm"))}
      {pivots && pivots.length > 1 && onPivotChange && (
        <label className="field">
          Drehpunkt
          <select value={pivot} onChange={(e) => onPivotChange(e.target.value)}>
            {pivots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {ROTATIONS.map(([k, l]) => row(k, l, Math.min(180, Math.max(20, Math.ceil(Math.abs(params[k]) / 10) * 10 + 10)), 0.5, "°"))}
      <div className="chip-row" aria-label="Drehen in 90°-Schritten">
        {(ROTATIONS as ["rx" | "ry" | "rz", string][]).map(([k]) => (
          <span key={k} className="chip-group">
            <button className="chip-btn" title={`${k === "rx" ? "Kippen" : k === "ry" ? "Neigen" : "Drehen"} −90°`} onClick={() => turn(k, -90)}>
              {k === "rx" ? "x" : k === "ry" ? "y" : "z"} −90°
            </button>
            <button className="chip-btn" title={`${k === "rx" ? "Kippen" : k === "ry" ? "Neigen" : "Drehen"} +90°`} onClick={() => turn(k, 90)}>
              +90°
            </button>
          </span>
        ))}
        <button className="chip-btn" title="Um die Längsachse (z) um 180° drehen" onClick={() => turn("rz", 180)}>
          z 180°
        </button>
      </div>
      {children}
      <button className="secondary-btn" onClick={() => onChange(IDENTITY_PARAMS)}>
        Registrierung zurücksetzen
      </button>
    </section>
  );
}

/** Angle in (−180°, 180°]. */
function normAngle(a: number): number {
  let x = ((a % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return Math.round(x * 100) / 100;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
