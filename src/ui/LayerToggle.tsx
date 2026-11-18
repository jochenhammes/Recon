import { lutGradient } from "../viewer/volume";
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

/** Compact layer list for the viewer: show/hide layers from any tab. */
export function LayerToggle({
  rows,
  onVisibleChange,
  onOpacityChange,
}: {
  rows: LayerToggleRow[];
  onVisibleChange: (id: string, visible: boolean) => void;
  onOpacityChange: (id: string, opacity: number) => void;
}) {
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
    </div>
  );
}
