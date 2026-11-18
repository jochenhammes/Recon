import { useMemo } from "react";
import { BigTable } from "../ui/BigTable";
import { Card } from "../ui/Card";
import { type VolumeStats, computeStats } from "../analysis/stats";
import type { Vec3, WorldToVoxel } from "../core/geometry";
import type { Mat4 } from "../core/transform";
import { transferVoi } from "../analysis/voiTransfer";
import { type VoiStats, voiStats } from "../edit/voi";
import type { Volume3D } from "../viewer/volume";
import { formatValue } from "./format";

export interface OverviewRow {
  id: string;
  label: string;
  volume: Volume3D;
  /** Own patient coordinates → reference world. */
  matrix: Mat4;
  /** Reference world → voxel index. */
  w2v: WorldToVoxel;
  scale: number;
  unitLabel: string;
}

export interface OverviewVoi {
  /** Mask on the grid of `volume` (the dataset the VOI was drawn on). */
  mask: Uint8Array;
  volume: Volume3D;
  w2v: WorldToVoxel;
  bounds: { min: Vec3; max: Vec3 } | null;
  label: string;
}

export interface DatasetOverviewProps {
  rows: OverviewRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  voi: OverviewVoi | null;
}

const statsCache = new WeakMap<Volume3D, VolumeStats>();
function statsOf(v: Volume3D): VolumeStats {
  let s = statsCache.get(v);
  if (!s) statsCache.set(v, (s = computeStats(v.data)));
  return s;
}

/** Statistics of all loaded datasets and of the current VOI on every dataset. */
export function DatasetOverview({ rows, selectedId, onSelect, voi }: DatasetOverviewProps) {
  const stats = useMemo(() => new Map(rows.map((r) => [r.id, statsOf(r.volume)])), [rows]);
  const voiRows = useMemo(() => {
    if (!voi) return null;
    const out = new Map<string, VoiStats | null>();
    for (const r of rows) {
      const t = r.volume === voi.volume ? { mask: voi.mask, bounds: voi.bounds } : transferVoi(voi, r);
      out.set(r.id, t ? voiStats(r.volume, t.mask, t.bounds) : null);
    }
    return out;
  }, [rows, voi]);
  const f = (r: OverviewRow, x: number) => (Number.isFinite(x) ? formatValue(x * r.scale) : "–");
  /** Variance scales with the square of the unit factor. */
  const v2 = (r: OverviewRow, x: number) => (Number.isFinite(x) ? formatValue(x * r.scale * r.scale) : "–");

  return (
    <>
      <Card title={<>Alle Datensätze</>}>
        <BigTable title="Alle Datensätze">
          <table className="region-table overview-table">
            <thead>
              <tr>
                <th>Datensatz</th>
                <th>Matrix</th>
                <th>Voxel (mm)</th>
                <th>Min</th>
                <th>Mittel</th>
                <th>Median</th>
                <th>Max</th>
                <th>SD</th>
                <th>Varianz</th>
                <th>Einheit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = stats.get(r.id)!;
                return (
                  <tr key={r.id} className={r.id === selectedId ? "reference-row clickable" : "clickable"} onClick={() => onSelect(r.id)} title="Für die Detailanalyse auswählen">
                    <td>{r.label}</td>
                    <td>
                      {r.volume.nx}×{r.volume.ny}×{r.volume.nz}
                    </td>
                    <td>{r.volume.geometry.spacing.map((v) => formatValue(v)).join("×")}</td>
                    <td>{f(r, s.min)}</td>
                    <td>{f(r, s.mean)}</td>
                    <td>{f(r, s.median)}</td>
                    <td>{f(r, s.max)}</td>
                    <td>{f(r, s.sd)}</td>
                    <td>{v2(r, s.variance)}</td>
                    <td>{r.unitLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </BigTable>
        <p className="tool-hint">Klick auf eine Zeile wählt den Datensatz für die Detailanalyse (Histogramm) aus.</p>
      </Card>
      {voi && voiRows && (
        <Card title={<>VOI auf allen Datensätzen</>}>
          <p className="hint">{voi.label} – über die Registrierung auf jeden Datensatz übertragen.</p>
          <BigTable title={`VOI auf allen Datensätzen – ${voi.label}`}>
            <table className="region-table overview-table">
              <thead>
                <tr>
                  <th>Datensatz</th>
                  <th>ml</th>
                  <th>Mittel</th>
                  <th>Peak</th>
                  <th>Max</th>
                  <th>SD</th>
                  <th>Varianz</th>
                  <th>Einheit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = voiRows.get(r.id);
                  return (
                    <tr key={r.id}>
                      <td>{r.label}</td>
                      {s && s.voxels > 0 ? (
                        <>
                          <td>{formatValue(s.volumeMl)}</td>
                          <td>{f(r, s.mean)}</td>
                          <td>{f(r, s.peak)}</td>
                          <td>{f(r, s.max)}</td>
                          <td>{f(r, s.sd)}</td>
                          <td>{v2(r, s.variance)}</td>
                        </>
                      ) : (
                        <td colSpan={6}>außerhalb</td>
                      )}
                      <td>{r.unitLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </BigTable>
          <p className="tool-hint">Peak: Mittel der 1-ml-Kugel um die heißesten Voxel in der VOI.</p>
        </Card>
      )}
    </>
  );
}
