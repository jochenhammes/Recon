import { AtlasPicker } from "./BrainCatalog";
import { useMemo, useRef, useState } from "react";
import { umlaut, withPatientId } from "../core/exportName";
import { BigTable } from "./BigTable";
import { Card } from "./Card";
import { InfoText } from "./Info";
import { type AtlasInfo, type RegionStat, labelHistogramCsv, labelStatsCsv, regionValues } from "../atlas/atlas";
import { buildZip } from "../export/zip";
import { Histogram } from "../components/Histogram";
import { formatValue } from "../components/format";
import { lutTable } from "../viewer/volume";
import type { Option } from "./NormalizationPanel";

export interface LabelSetOption extends Option {
  atlas: AtlasInfo;
}

export interface LabelAnalysisResult {
  stats: RegionStat[];
  /** Values (display units) and labels on the grid of the analysed dataset, for region histograms. */
  values: Float32Array;
  labels: Float32Array;
  unit: string;
  datasetLabel: string;
  /** e.g. "Labels über die Registrierung auf das PET-Raster übertragen (nächster Nachbar)". */
  note?: string;
}

export interface LabelAnalysisProps {
  labelSets: LabelSetOption[];
  targets: Option[];
  defaultTargetId: string | null;
  defaultLabelSetId: string | null;
  compute: (labelSetId: string, targetId: string) => LabelAnalysisResult;
  /** Loads a bundled brain atlas (catalogue id). */
  onLoadCerebra: (id: string) => void;
  cerebraLoading: boolean;
  /** Label image (NIfTI) with optional table, or a ZIP (e.g. AAL3 download). */
  onLoadOwn: (files: File[]) => void;
  loadError?: string | null;
  /** Names for a label image without a table: TotalSegmentator organ names or a label table file. */
  onAssignNames: (labelSetId: string, source: "totalseg" | File) => void;
}

/** True if the regions carry only placeholder names ("Region 5"). */
const unnamed = (a: AtlasInfo) => [...a.labels.values()].every((n) => /^Region \d+$/.test(n));

type SortKey = "index" | "name" | "mean" | "volume";

const AAL_URL = "https://www.gin.cnrs.fr/en/tools/aal/";

/** Region-wise statistics and histograms of any dataset within the regions of a label image (atlas, segmentation). */
export function LabelAnalysis(props: LabelAnalysisProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const tableInput = useRef<HTMLInputElement>(null);
  const [setId, setSetId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [result, setResult] = useState<(LabelAnalysisResult & { setId: string; targetId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<SortKey>("index");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hBins, setHBins] = useState(64);
  const [hRange, setHRange] = useState({ min: "", max: "" });
  const [hRelative, setHRelative] = useState(false);
  const [hInfo, setHInfo] = useState<string | null>(null);

  const labelSet = props.labelSets.find((s) => s.id === setId) ?? props.labelSets.find((s) => s.id === props.defaultLabelSetId) ?? props.labelSets[0] ?? null;
  const target = props.targets.find((t) => t.id === targetId) ?? props.targets.find((t) => t.id === props.defaultTargetId) ?? props.targets[0] ?? null;
  const current = result && labelSet && target && result.setId === labelSet.id && result.targetId === target.id ? result : null;
  const colors = useMemo(() => lutTable("labels"), []);

  const rows = useMemo(() => {
    if (!current) return [];
    const q = query.trim().toLowerCase();
    const r = current.stats.filter((s) => !q || s.name.toLowerCase().includes(q) || String(s.index) === q);
    if (sort === "name") r.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "mean") r.sort((a, b) => b.mean - a.mean);
    else if (sort === "volume") r.sort((a, b) => b.volumeMl - a.volumeMl);
    else r.sort((a, b) => a.index - b.index);
    return r;
  }, [current, sort, query]);

  const histIndices = useMemo(() => (selected.size ? selected : new Set(current?.stats.map((s) => s.index) ?? [])), [selected, current]);
  const histData = useMemo(() => (current ? regionValues(current.values, current.labels, histIndices) : null), [current, histIndices]);
  const histStats = useMemo(() => {
    if (!histData?.length) return null;
    let s = 0, ss = 0;
    for (const v of histData) s += v;
    const mean = s / histData.length;
    for (const v of histData) ss += (v - mean) ** 2;
    const variance = histData.length > 1 ? ss / (histData.length - 1) : 0;
    return { n: histData.length, mean, sd: Math.sqrt(variance), variance };
  }, [histData]);

  function run() {
    if (!labelSet || !target) return;
    setError(null);
    setBusy(true);
    // Let the button show the busy state before the (synchronous) computation.
    setTimeout(() => {
      try {
        setResult({ ...props.compute(labelSet.id, target.id), setId: labelSet.id, targetId: target.id });
        setSelected(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    }, 20);
  }

  function downloadCsv() {
    if (!current || !labelSet) return;
    const csv = labelStatsCsv(rows, { dataset: current.datasetLabel, atlas: labelSet.label, unit: current.unit, note: current.note });
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = withPatientId(`Labelanalyse_${current.datasetLabel.replace(/[äöüÄÖÜß]/g, umlaut).replace(/[^A-Za-z0-9_.-]+/g, "_")}.csv`);
    a.click();
    URL.revokeObjectURL(url);
  }

  const safe = (t: string) => t.replace(/[äöüÄÖÜß]/g, umlaut).replace(/[^A-Za-z0-9_.-]+/g, "_");
  const download = (bytes: BlobPart, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = withPatientId(name, { archive: true });
    a.click();
    URL.revokeObjectURL(url);
  };
  const num = (t: string) => (t.trim() === "" ? undefined : parseFloat(t.replace(",", ".")));
  const histCsv = (r: LabelAnalysisResult) =>
    "\ufeff" +
    labelHistogramCsv(r.values, r.labels, [...r.stats].sort((a, b) => a.index - b.index), { bins: hBins, min: num(hRange.min), max: num(hRange.max), relative: hRelative }, {
      dataset: r.datasetLabel,
      atlas: labelSet?.label ?? "",
      unit: r.unit,
      note: r.note,
    });

  function exportHistograms(all: boolean) {
    if (!labelSet) return;
    setHInfo(null);
    if (!all) {
      if (current) download(histCsv(current), `Histogramme_${safe(current.datasetLabel)}.csv`, "text/csv;charset=utf-8");
      return;
    }
    // One CSV per dataset (each with its own unit and, without a fixed range, its own bin range).
    const files: { name: string; bytes: Uint8Array }[] = [];
    const skipped: string[] = [];
    for (const t of props.targets) {
      try {
        const r = t.id === current?.targetId ? current : props.compute(labelSet.id, t.id);
        files.push({ name: withPatientId(`Histogramme_${safe(r.datasetLabel)}.csv`), bytes: new TextEncoder().encode(histCsv(r)) });
      } catch {
        skipped.push(t.label);
      }
    }
    if (files.length) download(buildZip(files), `Histogramme_${safe(labelSet.label)}.zip`, "application/zip");
    setHInfo(`${files.length} CSV-Datei(en) exportiert${skipped.length ? `; ohne Überlappung mit den Labels übersprungen: ${skipped.join(", ")}` : ""}.`);
  }

  const toggle = (index: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  const u = current?.unit ? ` ${current.unit}` : "";
  const fv = (v: number) => (Number.isFinite(v) ? formatValue(v) : "–");

  return (
    <Card title={<>Label-Analyse</>} info={
          <>
            <p>
              Statistik und Histogramm eines Datensatzes je Region einer Segmentierung oder eines Atlas (z. B. CT-Organe auf dem PET, Hirnatlas auf einem
              PET im Standardraum). Labels auf anderem Raster werden über die Registrierung übertragen (nächster Nachbar).
            </p>
            <p>
              Werte in den Einheiten des Datensatzes; Varianz in Einheit², SD und Varianz als Stichprobenwerte (n − 1).
            </p>
          </>
        }>
      <div className="button-row">
        <AtlasPicker busy={props.cerebraLoading} onLoad={props.onLoadCerebra} />
        <button className="secondary-btn" onClick={() => fileInput.current?.click()}>
          AAL3 / eigene Labels …
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept=".zip,.nii,.gz,.txt,.csv,.tsv,.lut,.label,.xml"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) props.onLoadOwn(files);
            e.target.value = "";
          }}
        />
      </div>
      <InfoText
        details={
          <>
            AAL3 (Rolls et al. 2020) wird wegen der Lizenzbedingungen nicht mitgeliefert: die ZIP-Datei herunterladen und hier direkt auswählen. Eigene
            Labels: NIfTI-Labelbild und optional die Tabelle (TXT/TSV/CSV/LUT) zusammen auswählen. Hirnatlanten gelten nur für Datensätze im MNI-Raum
            (Panel „Standardraum“).
          </>
        }
      >
        AAL3:{" "}
        <a href={AAL_URL} target="_blank" rel="noreferrer">
          herunterladen
        </a>{" "}
        und die ZIP hier auswählen.
      </InfoText>
      {props.loadError && <div className="error-banner">{props.loadError}</div>}

      {props.labelSets.length === 0 ? (
        <InfoText details="Labels entstehen durch die CT-Organsegmentierung (Bereich „Segmentierung & MTV“), einen Atlas (Bereich „Analyse“ bzw. „Standardraum“) oder ein geladenes Labelbild.">Noch keine Labels</InfoText>
      ) : (
        <>
          <label className="field">
            Labels
            <select value={labelSet?.id ?? ""} onChange={(e) => setSetId(e.target.value)}>
              {props.labelSets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.atlas.labels.size} Regionen)
                </option>
              ))}
            </select>
          </label>
          {labelSet && unnamed(labelSet.atlas) && (
            <div className="warning-banner">
              <span title="Diese Labels haben keine Namen (z. B. mit einer älteren Version exportiert). Namen zuordnen:">Labels ohne Namen – zuordnen:</span>
              <div className="button-row">
                {Math.max(...labelSet.atlas.labels.keys()) <= 117 && (
                  <button className="secondary-btn" onClick={() => props.onAssignNames(labelSet.id, "totalseg")}>
                    TotalSegmentator-Organnamen zuweisen
                  </button>
                )}
                <button className="secondary-btn" onClick={() => tableInput.current?.click()}>
                  Labeltabelle laden …
                </button>
                <input
                  ref={tableInput}
                  type="file"
                  hidden
                  accept=".txt,.csv,.tsv,.lut,.label,.xml"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) props.onAssignNames(labelSet.id, f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          )}
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
          <button className="primary-btn" disabled={!labelSet || !target || busy} onClick={run}>
            {busy ? "Wird ausgewertet …" : "Regionen auswerten"}
          </button>
        </>
      )}
      {error && <div className="error-banner">{error}</div>}

      {current && (
        <>
          {current.note && <p className="tool-hint">{current.note}</p>}
          <div className="label-hist-head">
            <strong>{selected.size === 0 ? "Histogramm: alle Regionen" : `Histogramm: ${selected.size === 1 ? current.stats.find((s) => selected.has(s.index))?.name : `${selected.size} Regionen`}`}</strong>
            {selected.size > 0 && (
              <button className="link-btn" onClick={() => setSelected(new Set())}>
                Auswahl aufheben
              </button>
            )}
          </div>
          {histStats && (
            <p className="tool-hint">
              {histStats.n.toLocaleString("de-DE")} Voxel · Mittel {fv(histStats.mean)}
              {u} · SD {fv(histStats.sd)}
              {u} · Varianz {fv(histStats.variance)}
              {u && `${u}²`}
            </p>
          )}
          {histData && histData.length > 0 && <Histogram key={[...histIndices].join(",")} data={histData} />}

          <div className="button-row">
            <button className="secondary-btn" onClick={downloadCsv}>
              Tabelle als CSV
            </button>
          </div>
          <h4 className="subheading">Histogramme je Label exportieren</h4>
          <div className="inline-fields hist-export-fields">
            <label className="field">
              Bins
              <select value={hBins} onChange={(e) => setHBins(Number(e.target.value))}>
                {[16, 32, 64, 100, 128, 256].map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              von
              <input placeholder="auto" value={hRange.min} onChange={(e) => setHRange({ ...hRange, min: e.target.value })} />
            </label>
            <label className="field">
              bis
              <input placeholder="auto" value={hRange.max} onChange={(e) => setHRange({ ...hRange, max: e.target.value })} />
            </label>
            <label className="field">
              Werte
              <select value={hRelative ? "rel" : "abs"} onChange={(e) => setHRelative(e.target.value === "rel")}>
                <option value="abs">Anzahl Voxel</option>
                <option value="rel">Anteil %</option>
              </select>
            </label>
          </div>
          <div className="button-row">
            <button className="secondary-btn" onClick={() => exportHistograms(false)}>
              Histogramme als CSV
            </button>
            {props.targets.length > 1 && (
              <button className="secondary-btn" onClick={() => exportHistograms(true)}>
                Alle Datensätze (ZIP, je eine CSV)
              </button>
            )}
          </div>
          <InfoText
            details={
              <>
                Zeilen = Labels, Spalten = Bins (gleiche Bins für alle Labels; Spaltenkopf = Bin-Untergrenze{current.unit ? ` in ${current.unit}` : ""}). Bereich
                leer = Minimum bis Maximum des jeweiligen Datensatzes in den Labels; Werte außerhalb eines festen Bereichs zählen in die erste/letzte Bin.
              </>
            }
          >
            Eine Zeile je Label, eine Spalte je Bin.
          </InfoText>
          {hInfo && <p className="tool-hint">{hInfo}</p>}
          <input className="label-search" type="search" placeholder="Region suchen …" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="segmented-control" role="group" aria-label="Sortierung">
            {(["index", "name", "mean", "volume"] as SortKey[]).map((k) => (
              <button key={k} className={sort === k ? "active" : ""} onClick={() => setSort(k)}>
                {k === "index" ? "Nr." : k === "name" ? "Name" : k === "mean" ? "Mittel ↓" : "Volumen ↓"}
              </button>
            ))}
          </div>
          <p className="tool-hint">Zeile anklicken = Region ins Histogramm (Mehrfachauswahl möglich).</p>
          <BigTable title={`Label-Analyse – ${labelSet.label} auf ${current.datasetLabel}`} onCsv={downloadCsv}>
            <table className="region-table label-stats-table">
              <thead>
                <tr>
                  <th>Region</th>
                  <th>ml</th>
                  <th>Mittel</th>
                  <th>SD</th>
                  <th>Varianz</th>
                  <th>Median</th>
                  <th>Min</th>
                  <th>Max</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const c = Math.min(255, r.index) * 3;
                  return (
                    <tr key={r.index} className={selected.has(r.index) ? "reference-row clickable" : "clickable"} onClick={() => toggle(r.index)} title={`Label ${r.index}, ${r.voxels} Voxel`}>
                      <td>
                        <span className="label-swatch" style={{ background: `rgb(${colors[c]},${colors[c + 1]},${colors[c + 2]})` }} />
                        {r.name}
                      </td>
                      <td>{formatValue(r.volumeMl)}</td>
                      <td>{fv(r.mean)}</td>
                      <td>{fv(r.sd)}</td>
                      <td>{fv(r.variance)}</td>
                      <td>{fv(r.median)}</td>
                      <td>{fv(r.min)}</td>
                      <td>{fv(r.max)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </BigTable>
          <p className="tool-hint">Werte in {current.unit || "Originaleinheiten"}.</p>
        </>
      )}
    </Card>
  );
}
