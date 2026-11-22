import { useEffect, useState } from "react";
import { IDENTITY_PARAMS, type TransformParams } from "../core/transform";

import { t } from "../i18n";
type Key = "tx" | "ty" | "tz" | "rx" | "ry" | "rz";
const TRANSLATIONS: [Key, string, string][] = [
  ["tx", "x (R↔L)", "Rechts ↔ Links"],
  ["ty", "y (A↔P)", "Anterior ↔ Posterior"],
  ["tz", "z (F↔K)", "Fuß ↔ Kopf"],
];
const ROTATIONS: [Key, string, string][] = [
  ["rx", "um x", "Kippen (um x)"],
  ["ry", "um y", "Neigen (um y)"],
  ["rz", "um z", "Drehen (um z)"],
];

export interface RegistrationPanelProps {
  params: TransformParams;
  onChange: (p: TransformParams) => void;
  /** Affine parameters (scale/shear) present: shown read-only. */
  children?: React.ReactNode;
  /** Rotation center choices (e.g. landmark 1, volume center); the parameters refer to the chosen one. */
  pivots?: { id: string; label: string }[];
  pivot?: string;
  onPivotChange?: (id: string) => void;
}

/** Number field that accepts free typing (comma or point) and applies valid values. */
function NumberField({ label, title, value, unit, onCommit }: { label: string; title: string; value: number; unit: string; onCommit: (v: number) => void }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const v = Number(text.replace(",", "."));
    if (Number.isFinite(v)) onCommit(v);
    else setText(fmt(value));
  };
  return (
    <label className="field" title={title}>
      {label} ({unit})
      <input type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
    </label>
  );
}

/** Manual rigid correction: compact number fields, 90° steps and optional fine sliders. */
export function RegistrationPanel({ params, onChange, children, pivots, pivot, onPivotChange }: RegistrationPanelProps) {
  const [sliders, setSliders] = useState(false);
  const set = (key: Key, v: number) => onChange({ ...params, [key]: key.startsWith("r") ? normAngle(v) : round(v) });
  const slider = (key: Key, label: string, range: number, unit: string) => (
    <label key={key} className="field slider-field">
      <span className="slider-label">
        {label}
        <span className="slider-value">
          {params[key].toFixed(1)} {unit}
        </span>
      </span>
      <input type="range" min={-range} max={range} step={0.5} value={params[key]} onChange={(e) => set(key, Number(e.target.value))} />
    </label>
  );
  return (
    <>
      {pivots && pivots.length > 1 && onPivotChange && (
        <label className="field">
          {t("Drehpunkt")}
          <select value={pivot} onChange={(e) => onPivotChange(e.target.value)}>
            {pivots.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="field-row three">
        {TRANSLATIONS.map(([k, l, t]) => (
          <NumberField key={k} label={l} title={t} value={params[k]} unit="mm" onCommit={(v) => set(k, v)} />
        ))}
      </div>
      <div className="field-row three">
        {ROTATIONS.map(([k, l, t]) => (
          <NumberField key={k} label={l} title={t} value={params[k]} unit="°" onCommit={(v) => set(k, v)} />
        ))}
      </div>
      <details className="compact-details">
        <summary>{t("In 90°-Schritten drehen")}</summary>
        <div className="chip-row">
          {ROTATIONS.map(([k, l]) => (
            <span key={k} className="chip-group">
              <button className="chip-btn" onClick={() => set(k, params[k] - 90)}>
                {l} −90°
              </button>
              <button className="chip-btn" onClick={() => set(k, params[k] + 90)}>
                +90°
              </button>
            </span>
          ))}
          <button className="chip-btn" onClick={() => set("rz", params.rz + 180)}>
            {t("um z 180°")}
          </button>
        </div>
      </details>
      <label className="checkbox-field">
        <input type="checkbox" checked={sliders} onChange={(e) => setSliders(e.target.checked)} />
        <span>{t("Schieberegler für die Feinarbeit")}</span>
      </label>
      {sliders && (
        <>
          {TRANSLATIONS.map(([k, , t]) => slider(k, t, Math.max(60, Math.ceil(Math.abs(params[k]) / 20) * 20 + 20), "mm"))}
          {ROTATIONS.map(([k, , t]) => slider(k, t, Math.min(180, Math.max(20, Math.ceil(Math.abs(params[k]) / 10) * 10 + 10)), "°"))}
        </>
      )}
      {children}
      <button className="secondary-btn" onClick={() => onChange(IDENTITY_PARAMS)}>
        {t("Manuelle Lage zurücksetzen")}
      </button>
    </>
  );
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

/** Angle in (−180°, 180°]. */
function normAngle(a: number): number {
  let x = ((a % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return Math.round(x * 100) / 100;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
