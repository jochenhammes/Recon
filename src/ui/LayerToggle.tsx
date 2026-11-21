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
  /** Acquisition time (ms) of the dataset or of the acquisition it belongs to: rows are sorted and grouped by it. */
  timeMs?: number;
}

/** Rows of one acquisition are at most this far apart (same as the dosimetry sessions). */
const SESSION_MS = 90 * 60 * 1000;
const fmtTime = (ms: number) => new Date(ms).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Chronological order (stable; rows without time keep their order at the end), with a group label per acquisition. */
function byTime(rows: LayerToggleRow[]): { row: LayerToggleRow; group?: string }[] {
  const timed = rows.filter((r) => r.timeMs !== undefined).sort((a, b) => a.timeMs! - b.timeMs!);
  if (timed.length === 0) return rows.map((row) => ({ row }));
  const untimed = rows.filter((r) => r.timeMs === undefined);
  const out: { row: LayerToggleRow; group?: string }[] = [];
  let start: number | undefined;
  for (const r of timed) {
    const newGroup = start === undefined || r.timeMs! - start > SESSION_MS;
    if (newGroup) start = r.timeMs!;
    out.push({ row: r, group: newGroup ? fmtTime(r.timeMs!) : undefined });
  }
  untimed.forEach((r, i) => out.push({ row: r, group: i === 0 ? "ohne Datum" : undefined }));
  return out;
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
  /** Own window of the MIP (null = like the dataset), its effective value and the value range for the sliders. */
  window: [number, number] | null;
  effectiveWindow: [number, number];
  range: [number, number];
  /** Display factor and unit of the values (e.g. SUV). */
  scale: number;
  unit: string;
  onWindowChange: (w: [number, number] | null) => void;
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
  const grouped = (list: LayerToggleRow[]) =>
    byTime(list).flatMap(({ row: r, group }) => [
      ...(group
        ? [
            <li key={`g-${r.id}`} className="layer-toggle-group" aria-hidden="true">
              {group}
            </li>,
          ]
        : []),
      row(r),
    ]);
  return (
    <div className="layer-toggle" role="dialog" aria-label="Ebenen">
      <ul>{grouped(shown)}</ul>
      {hidden.length > 0 && (
        <>
          <div className="layer-toggle-sep">nicht eingeblendet</div>
          <ul>{grouped(hidden)}</ul>
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
            <MipWindow mip={mip} />
          </div>
        </>
      )}
    </div>
  );
}

/** Two sliders (minimum, maximum) for the MIP's own window; "wie Datensatz" returns to the dataset's window. */
function MipWindow({ mip }: { mip: MipSettings }) {
  const [r0, r1] = mip.range;
  if (!(r1 > r0)) return null;
  const [lo, hi] = mip.effectiveWindow;
  const step = (r1 - r0) / 500;
  const fmt = (v: number) => Number((v * mip.scale).toPrecision(3)).toLocaleString("de-DE");
  const set = (a: number, b: number) => mip.onWindowChange([Math.min(a, b - step), Math.max(b, a + step)]);
  return (
    <div className="mip-window">
      <label title="Untergrenze des MIP-Fensters">
        <span>Min</span>
        <input type="range" min={r0} max={r1} step={step} value={Math.max(r0, Math.min(r1, lo))} onChange={(e) => set(Number(e.target.value), hi)} aria-label="MIP-Fenster Minimum" />
        <em>{fmt(lo)}</em>
      </label>
      <label title="Obergrenze des MIP-Fensters">
        <span>Max</span>
        <input type="range" min={r0} max={r1} step={step} value={Math.max(r0, Math.min(r1, hi))} onChange={(e) => set(lo, Number(e.target.value))} aria-label="MIP-Fenster Maximum" />
        <em>{fmt(hi)}</em>
      </label>
      <div className="mip-window-foot">
        <span>{mip.window ? "eigenes Fenster" : "Fenster wie Datensatz"}{mip.unit ? ` · ${mip.unit}` : ""}</span>
        {mip.window && (
          <button className="link-btn" onClick={() => mip.onWindowChange(null)}>
            wie Datensatz
          </button>
        )}
      </div>
    </div>
  );
}
