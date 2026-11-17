import type { RigidParams } from "../core/geometry";
import { IDENTITY_RIGID } from "../core/geometry";

const TRANSLATIONS: [keyof RigidParams, string][] = [
  ["tx", "Rechts ↔ Links (x)"],
  ["ty", "Anterior ↔ Posterior (y)"],
  ["tz", "Fuß ↔ Kopf (z)"],
];
const ROTATIONS: [keyof RigidParams, string][] = [
  ["rx", "Kippen (um x)"],
  ["ry", "Neigen (um y)"],
  ["rz", "Drehen (um z)"],
];

export interface RegistrationPanelProps {
  params: RigidParams;
  onChange: (p: RigidParams) => void;
  /** Warning if the frames of reference differ / are unknown. */
  frameNote?: string;
}

/** Manual rigid fine registration of the functional layer relative to the CT. */
export function RegistrationPanel({ params, onChange, frameNote }: RegistrationPanelProps) {
  const row = (key: keyof RigidParams, label: string, range: number, step: number, unit: string) => (
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
      <h3>Registrierung (PET/SPECT relativ zum CT)</h3>
      {frameNote && <p className="hint">{frameNote}</p>}
      {TRANSLATIONS.map(([k, l]) => row(k, l, 60, 0.5, "mm"))}
      {ROTATIONS.map(([k, l]) => row(k, l, 20, 0.5, "°"))}
      <button className="secondary-btn" onClick={() => onChange(IDENTITY_RIGID)}>
        Registrierung zurücksetzen
      </button>
    </section>
  );
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
