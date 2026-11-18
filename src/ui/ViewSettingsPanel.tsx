import { formatInput, parseInput } from "../components/format";
import type { LayerDisplay } from "../viewer/types";
import { type ColorLut, LUT_CHOICES } from "../viewer/volume";
import { useEffect, useState } from "react";

const LUT_OPTIONS = LUT_CHOICES;

export interface WindowPreset {
  label: string;
  /** Window in raw units. */
  window: [number, number];
}

export interface LayerSettingsProps {
  title: string;
  display: LayerDisplay;
  onChange: (d: LayerDisplay) => void;
  /** Display units: shown value = raw × scale. */
  scale: number;
  unitLabel: string;
  presets: WindowPreset[];
  /** Show the opacity slider (layer drawn on top of another). */
  showOpacity?: boolean;
  /** Show a visibility checkbox (only useful with more than one layer). */
  showVisibility?: boolean;
  children?: React.ReactNode;
}

/** Window, color table, presets and (for overlays) opacity of one viewer layer. */
export function LayerSettings({ title, display, onChange, scale, unitLabel, presets, showOpacity, showVisibility, children }: LayerSettingsProps) {
  return (
    <section className="card">
      <div className="layer-head">
        <h3>{title}</h3>
        {showVisibility && (
          <label className="checkbox-field">
            <input type="checkbox" checked={display.visible} onChange={(e) => onChange({ ...display, visible: e.target.checked })} />
            anzeigen
          </label>
        )}
      </div>
      <label className="field">
        Farbtabelle
        <select value={display.lut} onChange={(e) => onChange({ ...display, lut: e.target.value as ColorLut })}>
          {LUT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="field-row">
        <NumberField
          label={`Min${unitLabel ? ` (${unitLabel})` : ""}`}
          value={display.window[0] * scale}
          onCommit={(v) => onChange({ ...display, window: [v / scale, display.window[1]] })}
        />
        <NumberField
          label={`Max${unitLabel ? ` (${unitLabel})` : ""}`}
          value={display.window[1] * scale}
          onCommit={(v) => onChange({ ...display, window: [display.window[0], v / scale] })}
        />
      </div>
      <div className="chip-row">
        {presets.map((p) => (
          <button key={p.label} className="chip-btn" onClick={() => onChange({ ...display, window: p.window })}>
            {p.label}
          </button>
        ))}
      </div>
      {showOpacity && (
        <label className="field">
          Deckkraft {Math.round(display.opacity * 100)} %
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={display.opacity}
            onChange={(e) => onChange({ ...display, opacity: Number(e.target.value) })}
          />
        </label>
      )}
      {children}
    </section>
  );
}

/** Text input that keeps the user's typing and commits a parsed number on blur/Enter. */
export function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(formatInput(value));
  useEffect(() => setText(formatInput(value)), [value]);
  const commit = () => {
    const v = parseInput(text);
    if (Number.isFinite(v)) onCommit(v);
    else setText(formatInput(value));
  };
  return (
    <label className="field">
      {label}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    </label>
  );
}
