import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { LUT_CHOICES, lutGradient } from "../viewer/volume";
import type { ColorLut } from "../viewer/volume";

export interface LayerToggleRow {
  id: string;
  label: string;
  title?: string;
  lut: ColorLut;
  visible: boolean;
  /** Overlays: opacity 0..1 (slider); undefined = no slider (base). */
  opacity?: number;
  role: "overlay" | "base" | "hidden";
  /** Visibility cannot be changed (base without overlays). */
  locked?: boolean;
}

/** MIP view: its own dataset and color table. */
export interface MipSettings {
  options: { id: string; label: string; title?: string }[];
  /** Chosen dataset; null = automatic. */
  value: string | null;
  /** Label of the automatic choice (e.g. "PT · Patient"). */
  autoLabel: string;
  lut: ColorLut | null;
  onChange: (id: string | null) => void;
  onLutChange: (lut: ColorLut | null) => void;
}

/** Compact layer list for the viewer: show/hide layers from any tab. */
export function LayerToggle({
  rows,
  onVisibleChange,
  onOpacityChange,
  onRemove,
  mip,
}: {
  mip?: MipSettings;
  rows: LayerToggleRow[];
  onVisibleChange: (id: string, visible: boolean) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  /** Removes the dataset (trash icon; second click within a few seconds confirms). */
  onRemove?: (id: string) => void;
}) {
  // Two-step delete: the first click arms the trash icon ("Löschen?"), the second deletes.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const shown = rows.filter((r) => r.role !== "hidden");
  const hidden = rows.filter((r) => r.role === "hidden");
  const row = (r: LayerToggleRow) => (
    <li key={r.id} className={r.visible && r.role !== "hidden" ? "" : "off"}>
      <label title={r.title}>
        <input type="checkbox" checked={r.visible && r.role !== "hidden"} disabled={r.locked} onChange={(e) => onVisibleChange(r.id, e.target.checked)} />
        <i className="lut-swatch" style={{ background: lutGradient(r.lut) }} aria-hidden="true" />
        <span className="layer-toggle-name">{r.label}</span>
        {r.role === "base" && <em>Basis</em>}
      </label>
      {r.opacity !== undefined && r.role === "overlay" && (
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={r.opacity}
          disabled={!r.visible}
          aria-label={`Deckkraft ${r.label}`}
          title={`Deckkraft ${Math.round(r.opacity * 100)} %`}
          onChange={(e) => onOpacityChange(r.id, Number(e.target.value))}
        />
      )}
      {onRemove && (
        <button
          className={`layer-trash${armed === r.id ? " armed" : ""}`}
          title={armed === r.id ? "Nochmals klicken: Datensatz entfernen" : `${r.title ?? r.label} entfernen`}
          aria-label={armed === r.id ? `Entfernen von ${r.label} bestätigen` : `${r.label} entfernen`}
          onClick={() => {
            if (armed === r.id) {
              setArmed(null);
              onRemove(r.id);
            } else setArmed(r.id);
          }}
        >
          <Trash2 size={12} />
          {armed === r.id && <span>Löschen?</span>}
        </button>
      )}
    </li>
  );
  return (
    <div className="layer-toggle" role="dialog" aria-label="Ebenen">
      <ul>{shown.map(row)}</ul>
      {hidden.length > 0 && (
        <>
          <div className="layer-toggle-sep">nicht eingeblendet</div>
          <ul>{hidden.map(row)}</ul>
        </>
      )}
      {mip && (
        <>
          <div className="layer-toggle-sep">MIP</div>
          <div className="layer-mip">
            <select value={mip.value ?? ""} aria-label="Datensatz der MIP" onChange={(e) => mip.onChange(e.target.value || null)}>
              <option value="">automatisch ({mip.autoLabel})</option>
              {mip.options.map((o) => (
                <option key={o.id} value={o.id} title={o.title}>
                  {o.label}
                </option>
              ))}
            </select>
            <select value={mip.lut ?? ""} aria-label="Farbtabelle der MIP" onChange={(e) => mip.onLutChange((e.target.value || null) as ColorLut | null)}>
              <option value="">LUT wie Datensatz</option>
              {LUT_CHOICES.filter((l) => l.value !== "labels").map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  );
}
