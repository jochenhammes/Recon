import { useMemo, useRef, useState } from "react";
import { type AtlasInfo, REFERENCE_PRESETS, type RegionStat, pooledMean, presetIndices, regionCsv } from "../atlas/atlas";
import type { Option } from "./NormalizationPanel";

export interface AtlasOption extends Option {
  atlas: AtlasInfo;
}

export interface RegionResult {
  stats: RegionStat[];
  unit: string;
  datasetLabel: string;
}

export interface AtlasPanelProps {
  atlases: AtlasOption[];
  onLoadBundled: () => void;
  bundledLoading: boolean;
  /** Label image (NIfTI) and optional label table (TXT/CSV/TSV/LUT). */
  onLoadOwn: (files: File[]) => void;
  /** Datasets to evaluate (usually PET in standard space). */
  targets: Option[];
  defaultTargetId: string | null;
  compute: (atlasId: string, targetId: string) => RegionResult;
  onCreateSuvrImage: (targetId: string, refMean: number, refLabel: string) => void;
  error?: string | null;
}

type SortKey = "name" | "index" | "suvr";

/** Atlas-based regional statistics and SUVR (reference region normalization). */
export function AtlasPanel(props: AtlasPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [atlasId, setAtlasId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [refMode, setRefMode] = useState<string>("cerebellum-gm");
  const [customRefs, setCustomRefs] = useState<number[]>([]);
  const [result, setResult] = useState<(RegionResult & { atlasId: string; targetId: string }) | null>(null);
  const [sort, setSort] = useState<SortKey>("name");
  const [error, setError] = useState<string | null>(null);

  const atlas = props.atlases.find((a) => a.id === atlasId) ?? props.atlases[0] ?? null;
  const target = props.targets.find((t) => t.id === targetId) ?? props.targets.find((t) => t.id === props.defaultTargetId) ?? props.targets[0] ?? null;

  const presets = useMemo(
    () => (atlas ? REFERENCE_PRESETS.map((p) => ({ ...p, indices: presetIndices(atlas.atlas, p) })).filter((p) => p.indices.size > 0) : []),
    [atlas],
  );
  const preset = presets.find((p) => p.id === refMode);
  const effectiveMode = preset ? refMode : refMode === "custom" ? "custom" : (presets[0]?.id ?? "custom");
  const refIndices = effectiveMode === "custom" ? new Set(customRefs) : (presets.find((p) => p.id === effectiveMode)?.indices ?? new Set<number>());
  const refLabel = effectiveMode === "custom" ? `Eigene Auswahl (${customRefs.length} Regionen)` : (presets.find((p) => p.id === effectiveMode)?.label ?? "");

  const current = result && atlas && target && result.atlasId === atlas.id && result.targetId === target.id ? result : null;
  const refMean = current ? pooledMean(current.stats, refIndices) : NaN;
  const rows = useMemo(() => {
    if (!current) return [];
    const r = [...current.stats];
    if (sort === "name") r.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "index") r.sort((a, b) => a.index - b.index);
    else r.sort((a, b) => b.mean - a.mean);
    return r;
  }, [current, sort]);

  function run() {
    if (!atlas || !target) return;
    setError(null);
    try {
      setResult({ ...props.compute(atlas.id, target.id), atlasId: atlas.id, targetId: target.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function downloadCsv() {
    if (!current || !atlas) return;
    const csv = regionCsv(rows, refMean, { dataset: current.datasetLabel, atlas: atlas.label, reference: refLabel, unit: current.unit || "Wert" });
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `SUVR_${current.datasetLabel.replace(/[^A-Za-z0-9_.-]+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Adaptive precision for measured values (large Bq/ml numbers need no decimals). */
  const fmtVal = (v: number) => fmt(v, Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 10 ? 1 : 3);
  const fmt = (v: number, d = 3) => (Number.isFinite(v) ? v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");

  return (
    <section className="card">
      <h3>Atlas &amp; SUVR</h3>
      <p className="hint">
        Regionale Mittelwerte eines Datensatzes im Standardraum (z. B. des übertragenen PET) und SUVR = Regionsmittel / Mittel der Referenzregion.
      </p>
      <div className="button-row">
        <button className="secondary-btn" disabled={props.bundledLoading} onClick={props.onLoadBundled}>
          {props.bundledLoading ? "Wird geladen …" : "CerebrA-Atlas laden"}
        </button>
        <button className="secondary-btn" onClick={() => fileInput.current?.click()}>
          Eigener Atlas …
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept=".nii,.gz,.txt,.csv,.tsv,.lut,.label"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) props.onLoadOwn(files);
            e.target.value = "";
          }}
        />
      </div>
      <p className="tool-hint">Eigener Atlas: Labelbild (NIfTI, im Standardraum) und optional die Labeltabelle (TXT/CSV/TSV, FSL-/FreeSurfer-LUT, ITK-SNAP) zusammen auswählen.</p>
      {(props.error || error) && <div className="error-banner">{props.error || error}</div>}

      {atlas && (
        <>
          <label className="field">
            Atlas
            <select value={atlas.id} onChange={(e) => setAtlasId(e.target.value)}>
              {props.atlases.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.atlas.labels.size} Regionen)
                </option>
              ))}
            </select>
          </label>
          {atlas.atlas.attribution && <p className="tool-hint">{atlas.atlas.attribution}</p>}
          <label className="field">
            Datensatz
            <select value={target?.id ?? ""} onChange={(e) => setTargetId(e.target.value)}>
              {props.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Referenzregion
            <select value={effectiveMode} onChange={(e) => setRefMode(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.indices.size})
                </option>
              ))}
              <option value="custom">Eigene Auswahl …</option>
            </select>
          </label>
          {effectiveMode === "custom" && (
            <label className="field">
              Regionen (Strg/⌘ für Mehrfachauswahl)
              <select
                multiple
                size={8}
                value={customRefs.map(String)}
                onChange={(e) => setCustomRefs([...e.target.selectedOptions].map((o) => Number(o.value)))}
              >
                {[...atlas.atlas.labels].sort((a, b) => a[1].localeCompare(b[1])).map(([i, n]) => (
                  <option key={i} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="primary-btn" disabled={!target} onClick={run}>
            Regionen auswerten
          </button>
        </>
      )}

      {current && (
        <>
          <p className="tool-hint">
            Referenz: {refLabel} – Mittel {fmtVal(refMean)} {current.unit}
            {!Number.isFinite(refMean) && " (keine Voxel in der Referenzregion)"}
          </p>
          <div className="button-row">
            <button className="secondary-btn" onClick={downloadCsv}>
              Tabelle als CSV
            </button>
            <button className="secondary-btn" disabled={!Number.isFinite(refMean) || !(refMean > 0)} onClick={() => target && props.onCreateSuvrImage(target.id, refMean, refLabel)}>
              SUVR-Bild anlegen
            </button>
          </div>
          <div className="segmented-control" role="group" aria-label="Sortierung">
            {(["name", "index", "suvr"] as SortKey[]).map((k) => (
              <button key={k} className={sort === k ? "active" : ""} onClick={() => setSort(k)}>
                {k === "name" ? "Name" : k === "index" ? "Index" : "SUVR ↓"}
              </button>
            ))}
          </div>
          <div className="region-table-wrap">
            <table className="region-table">
              <thead>
                <tr>
                  <th>Region</th>
                  <th>ml</th>
                  <th>Mittel</th>
                  <th>SUVR</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.index} className={refIndices.has(r.index) ? "reference-row" : undefined}>
                    <td title={`Index ${r.index}, ${r.voxels} Voxel, Median ${fmtVal(r.median)}, SD ${fmtVal(r.sd)}`}>{r.name}</td>
                    <td>{fmt(r.volumeMl, 1)}</td>
                    <td>{fmtVal(r.mean)}</td>
                    <td>{fmt(r.mean / refMean, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
