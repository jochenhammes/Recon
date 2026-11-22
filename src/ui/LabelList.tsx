import { useMemo, useState } from "react";
import type { LabelStat } from "../atlas/labelStats";
import { formatValue } from "../components/format";
import { lutTable } from "../viewer/volume";

import { t } from "../i18n";
export interface LabelListProps {
  names: Map<number, string>;
  stats: Map<number, LabelStat>;
  /** Labels shown in the viewer (undefined = all). */
  visible?: number[];
  onVisibleChange: (ids: number[] | undefined) => void;
  onGoto: (id: number) => void;
}

const LUT = lutTable("labels");
const color = (id: number) => {
  const c = Math.min(255, Math.max(0, Math.round(id))) * 3;
  return `rgb(${LUT[c]}, ${LUT[c + 1]}, ${LUT[c + 2]})`;
};

/** Regions of a label image: colour, name, volume; click jumps to the region, checkboxes filter the display. */
export function LabelList({ names, stats, visible, onVisibleChange, onGoto }: LabelListProps) {
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      [...stats.values()]
        .map((s) => ({ ...s, name: names.get(s.id) ?? t("Region {id}", { id: s.id }) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stats, names],
  );
  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || String(r.id) === q) : rows;
  const all = rows.map((r) => r.id);
  const vis = new Set(visible ?? all);
  const set = (ids: number[]) => onVisibleChange(ids.length === all.length ? undefined : ids);

  return (
    <div className="label-list">
      <div className="label-list-head">
        <input type="search" placeholder={t("{length} Regionen durchsuchen …", { length: rows.length })} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="link-btn" onClick={() => set(all)}>
          {t("alle")}
        </button>
        <button className="link-btn" onClick={() => set([])}>
          {t("keine")}
        </button>
        {q && (
          <button className="link-btn" title={t("Nur die gefundenen Regionen anzeigen")} onClick={() => set(shown.map((r) => r.id))}>
            {t("nur Treffer")}
          </button>
        )}
      </div>
      <div className="label-list-body">
        {shown.map((r) => (
          <div key={r.id} className="label-row" onClick={() => onGoto(r.id)} title={t("Label {id} · {voxels} Voxel – klicken: Fadenkreuz in die Region", { id: r.id, voxels: r.voxels })}>
            <input
              type="checkbox"
              checked={vis.has(r.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => set(e.target.checked ? [...vis, r.id] : [...vis].filter((x) => x !== r.id))}
            />
            <span className="label-swatch" style={{ background: color(r.id) }} />
            <span className="label-name">{r.name}</span>
            <span className="label-ml">{formatValue(r.volumeMl)} ml</span>
          </div>
        ))}
        {shown.length === 0 && <p className="tool-hint">{t("Keine Region gefunden.")}</p>}
      </div>
    </div>
  );
}
