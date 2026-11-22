import { AtlasPicker } from "../ui/BrainCatalog";
import { useEffect, useMemo, useState } from "react";
import { umlaut, withPatientId } from "../core/exportName";
import { BigTable } from "../ui/BigTable";
import { Card } from "../ui/Card";
import { InfoText } from "../ui/Info";
import { type AtlasInfo, REFERENCE_PRESETS, presetIndices } from "../atlas/atlas";
import { formatValue } from "../components/format";
import { csvText, csvWithInfo } from "../core/csv";
import type { LoadedDataset } from "../dataset/types";
import type { Option } from "../ui/NormalizationPanel";
import { Chart, type ChartSeries } from "./Chart";
import type { FrameMotion } from "./motion";
import { type PatlakFit, patlakFit, patlakSetup } from "./patlak";
import { runKineticsJob } from "./runner";
import { type SrtmFit, srtmFit, srtmSetup } from "./srtm";
import { type FrameTiming, frameMids, parseFrameDurations, regionTac } from "./tac";

import { t } from "../i18n";
export interface KineticsApi {
  dynamics: { id: string; label: string; dataset: LoadedDataset; inMni: boolean }[];
  t1s: Option[];
  atlases: { id: string; label: string; atlas: AtlasInfo }[];
  setTiming: (id: string, startSec: number[], durationSec: number[]) => void;
  applyMotion: (id: string, frames: Float32Array[], motion: FrameMotion[]) => void;
  /** Normalizes the dynamic dataset (via T1 or the SPM PET template) and creates its frames in MNI space; returns the new id. */
  toMni: (id: string, t1Id: string | null, status: (s: string) => void, window: { fromMin: number; toMin: number }) => Promise<string>;
  /** Atlas labels on the grid of a dataset. */
  labelsFor: (atlasId: string, targetId: string) => Float32Array;
  /** Creates the maps as datasets; returns their ids. */
  addMaps: (sourceId: string, maps: { label: string; data: Float32Array; window: [number, number]; visible?: boolean }[]) => { id: string; label: string }[];
  /** Shows a dataset as the top overlay. */
  showDataset: (id: string) => void;
  /** Loads a bundled brain atlas (catalogue id). */
  loadCerebra: (id: string) => void;
  atlasBusy: boolean;
  /** Reports the running step (for the activity indicator); null when idle. */
  onActivity?: (a: { label: string; fraction: number | null } | null) => void;
}

type Model = "patlak" | "srtm";

interface RegionRow {
  index: number;
  name: string;
  voxels: number;
  tac: number[];
  patlak?: PatlakFit;
  srtm?: SrtmFit;
}

interface Result {
  dynId: string;
  model: Model;
  atlasLabel: string;
  refLabel: string;
  tStarMin: number;
  cref: number[];
  mids: number[];
  rows: RegionRow[];
}

const fmt = (v: number, d = 3) => (Number.isFinite(v) ? v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
const minutes = (s: number[]) => s.map((x) => x / 60);

/** Reference-tissue kinetic modelling of dynamic brain PET (Patlak, SRTM). */
export function KineticsPanel({ api }: { api: KineticsApi }) {
  const [dynId, setDynId] = useState<string | null>(null);
  const dyn = api.dynamics.find((d) => d.id === dynId) ?? api.dynamics.findLast((d) => d.inMni) ?? api.dynamics[0] ?? null;
  const info = dyn?.dataset.dynamic;
  const [durText, setDurText] = useState("");
  const [timingMsg, setTimingMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fromSec, setFromSec] = useState("120");
  const [t1Id, setT1Id] = useState<string>("");
  const [motionRef, setMotionRef] = useState<string>("sum");
  const [regFrom, setRegFrom] = useState("0");
  const [regTo, setRegTo] = useState("10");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [atlasId, setAtlasId] = useState<string | null>(null);
  const atlas = api.atlases.find((a) => a.id === atlasId) ?? api.atlases.find((a) => /cerebra|aal/i.test(a.label)) ?? api.atlases[0] ?? null;
  const [refMode, setRefMode] = useState("cerebellum-gm");
  const [model, setModel] = useState<Model>("srtm");
  const [tStar, setTStar] = useState("15");
  const [makeMaps, setMakeMaps] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const onActivity = api.onActivity;
  useEffect(() => {
    onActivity?.(busy ? { label: busy, fraction: progress } : null);
  }, [busy, progress, onActivity]);
  const [selected, setSelected] = useState<number | null>(null);
  const [createdMaps, setCreatedMaps] = useState<{ dynId: string; maps: { id: string; label: string; hint: string }[] } | null>(null);

  const presets = useMemo(() => (atlas ? REFERENCE_PRESETS.filter((p) => p.id !== "whole").map((p) => ({ ...p, indices: presetIndices(atlas.atlas, p) })).filter((p) => p.indices.size) : []), [atlas]);
  const preset = presets.find((p) => p.id === refMode) ?? presets[0];

  // Whole-volume TAC (voxels above 20 % of the mean image maximum) for a first look at the data.
  const globalTac = useMemo(() => {
    if (!info) return null;
    const mean = dyn!.dataset.current.data;
    let mx = 0;
    for (const v of mean) if (v > mx) mx = v;
    return Array.from(regionTac(info.frames, (i) => mean[i] > 0.2 * mx));
  }, [info, dyn]);

  const run = async <T,>(label: string, f: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    setProgress(null);
    try {
      return await f();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  function applyDurations() {
    if (!dyn || !info) return;
    const d = parseFrameDurations(durText, info.frames.length);
    if (typeof d === "string") {
      setTimingMsg({ ok: false, text: d });
      return;
    }
    const start: number[] = [];
    let acc = 0;
    for (const x of d) {
      start.push(acc);
      acc += x;
    }
    api.setTiming(dyn.id, start, d);
    setTimingMsg({ ok: true, text: t("Übernommen: {length} Frames, Gesamtdauer {v} min.", { length: d.length, v: fmt(acc / 60, 1) }) });
  }

  const motionCorrect = () =>
    run("Bewegungskorrektur", async () => {
      if (!dyn || !info) return;
      const v = dyn.dataset.current;
      const r = await runKineticsJob<{ frames: Float32Array[]; motion: FrameMotion[] }>(
        {
          type: "motion",
          frames: info.frames,
          grid: { nx: v.nx, ny: v.ny, nz: v.nz, geometry: v.geometry },
          startSec: info.start,
          durationSec: info.duration,
          fromSec: parseFloat(fromSec) || 0,
          referenceFrame: motionRef === "sum" ? undefined : Number(motionRef),
        },
        (d, t) => setProgress(t ? d / t : null),
      ).promise;
      api.applyMotion(dyn.id, r.frames, r.motion);
    });

  const toMni = () =>
    run("Normalisierung", async () => {
      if (!dyn) return;
      const end = info ? (info.start.at(-1)! + info.duration.at(-1)!) / 60 : 1e9;
      const num = (t: string, d: number) => (t.trim() === "" ? d : parseFloat(t.replace(",", ".")));
      const id = await api.toMni(dyn.id, t1Id || null, (s) => setBusy(s), { fromMin: num(regFrom, 0), toMin: num(regTo, end) });
      setDynId(id);
    });

  const compute = () =>
    run("Kinetik", async () => {
      if (!dyn || !info || !atlas || !preset) return;
      const labels = api.labelsFor(atlas.id, dyn.id);
      const timing: FrameTiming = { start: minutes(info.start), duration: minutes(info.duration) };
      const refSet = preset.indices;
      const cref = Array.from(regionTac(info.frames, (i) => refSet.has(Math.round(labels[i]))));
      if (!cref.some((c) => c > 0)) throw new Error(t("Referenzregion enthält keine Daten – liegen Atlas und Datensatz im selben Raum?"));
      const tStarMin = parseFloat(tStar.replace(",", ".")) || 0;
      const ps = model === "patlak" ? patlakSetup(cref, timing, tStarMin) : null;
      const ss = model === "srtm" ? srtmSetup(cref, timing) : null;
      // Regional fits: one TAC per atlas region.
      const groups = new Map<number, number[]>();
      for (let i = 0; i < labels.length; i++) {
        const l = Math.round(labels[i]);
        if (l <= 0 || !atlas.atlas.labels.has(l)) continue;
        let g = groups.get(l);
        if (!g) groups.set(l, (g = []));
        g.push(i);
      }
      const rows: RegionRow[] = [];
      for (const [index, vox] of groups) {
        const tac = info.frames.map((f) => {
          let s = 0;
          for (const i of vox) s += f[i];
          return s / vox.length;
        });
        rows.push({ index, name: atlas.atlas.labels.get(index)!, voxels: vox.length, tac, patlak: ps ? patlakFit(tac, ps) : undefined, srtm: ss ? srtmFit(tac, ss) : undefined });
      }
      rows.sort((a, b) => a.index - b.index);
      setResult({ dynId: dyn.id, model, atlasLabel: atlas.label, refLabel: preset.label, tStarMin, cref, mids: frameMids(timing), rows });
      setSelected(rows.find((r) => !refSet.has(r.index))?.index ?? null);
      if (makeMaps) {
        setBusy("Parameterkarten");
        const mask = Uint8Array.from(labels, (l) => (l > 0 ? 1 : 0));
        const r = await runKineticsJob<{ maps: Record<string, Float32Array> }>(
          { type: "maps", model, frames: info.frames, cref, start: timing.start, duration: timing.duration, tStarMin, mask },
          (d, t) => setProgress(t ? d / t : null),
        ).promise;
        const win = (a: Float32Array, lo = 0): [number, number] => {
          const v = Array.from(a).filter((x) => x !== 0 && Number.isFinite(x)).sort((p, q) => p - q);
          return [lo, v.length ? v[Math.floor(0.99 * (v.length - 1))] : 1];
        };
        const defs =
          model === "patlak"
            ? [
                { label: `Ki_ref (Patlak, t* ${tStarMin} min)`, data: r.maps.ki, window: win(r.maps.ki), hint: t("Einstromkonstante relativ zur Referenz (1/min)") },
                { label: t("V (Patlak-Achsenabschnitt)"), data: r.maps.intercept, window: win(r.maps.intercept), visible: false, hint: t("Verteilungsvolumen relativ zur Referenz") },
                { label: "R² (Patlak)", data: r.maps.r2, window: [0, 1] as [number, number], visible: false, hint: t("Linearität des Patlak-Plots ab t*") },
              ]
            : [
                { label: "BP_ND (SRTM)", data: r.maps.bp, window: win(r.maps.bp), hint: t("Bindungspotenzial (nicht verdrängbar)") },
                { label: "R1 (SRTM)", data: r.maps.r1, window: [0, 2] as [number, number], visible: false, hint: t("relativer Einstrom K1/K1′ (Perfusion)") },
                { label: "k2 (SRTM)", data: r.maps.k2, window: win(r.maps.k2), visible: false, hint: t("Auswaschrate der Zielregion (1/min)") },
                { label: "k2a (SRTM)", data: r.maps.k2a, window: win(r.maps.k2a), visible: false, hint: t("scheinbare Auswaschrate k2/(1+BP_ND) (1/min)") },
                { label: "R² (SRTM)", data: r.maps.r2, window: [0, 1] as [number, number], visible: false, hint: t("Fitgüte je Voxel") },
              ];
        const made = api.addMaps(dyn.id, defs);
        setCreatedMaps({ dynId: dyn.id, maps: made.map((m, i) => ({ ...m, hint: defs[i].hint })) });
      }
    });

  function downloadCsv() {
    if (!result) return;
    const f = (v: number, d = 5) => (Number.isFinite(v) ? v.toFixed(d).replace(".", ",") : "");
    const sep = ";";
    const head = result.model === "patlak" ? ["Index", "Region", "Voxel", "Ki_ref_1/min", "Achsenabschnitt", "R2"] : ["Index", "Region", "Voxel", "BP_ND", "R1", "k2_1/min", "k2a_1/min", "R2"];
    const rows = result.rows.map((r) =>
      result.model === "patlak"
        ? [r.index, csvText(r.name), r.voxels, f(r.patlak!.ki), f(r.patlak!.intercept), f(r.patlak!.r2, 4)].join(sep)
        : [r.index, csvText(r.name), r.voxels, f(r.srtm!.bp), f(r.srtm!.r1), f(r.srtm!.k2), f(r.srtm!.k2a), f(r.srtm!.r2, 4)].join(sep),
    );
    const tacHead = ["Frame_Mitte_min", "Referenz", ...result.rows.map((r) => csvText(r.name))].join(sep);
    const tacRows = result.mids.map((t, i) => [f(t, 3), f(result.cref[i]), ...result.rows.map((r) => f(r.tac[i]))].join(sep));
    const csv = csvWithInfo([head.join(sep), ...rows, "", tacHead, ...tacRows], [
      ["Datensatz", dyn?.label ?? ""],
      ["Modell", result.model === "patlak" ? t("Patlak (Referenz), t* = {tStarMin} min", { tStarMin: result.tStarMin }) : t("SRTM (Basisfunktionen, Gunn 1997)")],
      ["Atlas", result.atlasLabel],
      ["Referenzregion", result.refLabel],
    ]);
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = withPatientId(t("Kinetik_{model}_{v}.csv", { model: result.model, v: (dyn?.label ?? "").replace(/[äöüÄÖÜß]/g, umlaut).replace(/[^A-Za-z0-9_.-]+/g, "_") }));
    a.click();
    URL.revokeObjectURL(url);
  }

  const current = result && result.dynId === dyn?.id ? result : null;
  const sel = current?.rows.find((r) => r.index === selected) ?? null;
  const tacSeries: ChartSeries[] = current
    ? [
        { label: t("Referenz"), x: current.mids, y: current.cref, style: "both", color: "#8a8f98" },
        ...(sel ? [{ label: sel.name, x: current.mids, y: sel.tac, style: "points" as const, color: "#a78bfa" }] : []),
        ...(sel?.srtm?.fitted.length ? [{ label: t("SRTM-Fit"), x: current.mids, y: sel.srtm.fitted, style: "line" as const, color: "#f59e0b" }] : []),
      ]
    : globalTac && info
      ? [{ label: t("Mittel (Gehirn/Volumen)"), x: frameMids({ start: minutes(info.start), duration: minutes(info.duration) }), y: globalTac, style: "both", color: "#a78bfa" }]
      : [];
  const patlakSeries: ChartSeries[] =
    sel?.patlak
      ? [
          { label: t("Patlak-Punkte"), x: sel.patlak.x, y: sel.patlak.y, style: "points", color: "#a78bfa" },
          { label: t("Fit"), x: [0, Math.max(...sel.patlak.x)], y: [sel.patlak.intercept, sel.patlak.intercept + sel.patlak.ki * Math.max(...sel.patlak.x)], style: "line", color: "#f59e0b" },
        ]
      : [];
  const maxShift = info?.motion ? Math.max(...info.motion.map((m) => m.maxShiftMm)) : null;

  return (
    <>
      <Card title={<>{t("1 · Dynamische Serie")}</>} info={
            <>
              {t("Kinetische Modellierung mit Referenzregion (ohne Blutentnahme): Patlak für irreversibel bindende Tracer (z. B. FDOPA, FDG) und SRTM für reversibel bindende Tracer (Rezeptorliganden, Amyloid). Portierung eines MATLAB-Pakets der wissenschaftlichen Arbeitsgruppe MMNI der Universität zu Köln, deren Alumnus der Autor dieser App ist (github.com/ghaefner/kinetic-modeling).")}
            </>
          } done={!!dyn?.inMni} status={info ? { text: t("{length} Frames{v}", { length: info.frames.length, v: dyn?.inMni ? " · MNI" : "" }), tone: dyn?.inMni ? "ok" : "info" } : { text: t("keine Daten"), tone: "warn" }}>
        {api.dynamics.length === 0 ? (
          <InfoText details={t("Im Bereich „Daten“ eine dynamische DICOM-Serie oder ein 4D-NIfTI (+ BIDS-JSON mit Frame-Zeiten) laden.")}>{t("Keine dynamischen Daten")}</InfoText>
        ) : (
          <>
            <label className="field">
              {t("Serie")}
              <select value={dyn?.id ?? ""} disabled={!!busy} onChange={(e) => (setDynId(e.target.value), setResult(null))}>
                {api.dynamics.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                    {d.inMni ? " (MNI)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {info && (
              <>
                <p className="tool-hint">
                  {info.frames.length} Frames, {fmt((info.start.at(-1)! + info.duration.at(-1)!) / 60, 1)} min · Zeiten aus{" "}
                  {info.timeSource === "dicom" ? "DICOM-Header" : info.timeSource === "bids" ? "BIDS-JSON" : info.timeSource === "nifti" ? "NIfTI (pixdim)" : "Eingabe"}
                  {info.motion ? ` · bewegungskorrigiert (max. ${fmt(maxShift!, 1)} mm)` : ""}
                </p>
                {info.note && <p className="warning-banner">{info.note}</p>}
                <details className="kin-frames">
                  <summary>{t("Frame-Zeiten anzeigen / eingeben")}</summary>
                  <table className="region-table">
                    <thead>
                      <tr>
                        <th>{t("Frame")}</th>
                        <th>{t("Start (s)")}</th>
                        <th>{t("Dauer (s)")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {info.start.map((s, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>{formatValue(s)}</td>
                          <td>{formatValue(info.duration[i])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <label className="field">
                    {t("Frame-Dauern in Sekunden ({n} Frames): ein Wert für alle, eine Liste oder Anzahl×Dauer; Start = Summe der vorherigen", { n: info.frames.length })}
                    <input
                      value={durText}
                      placeholder={t("z. B. 60  oder  6x10, 3x20, 2x30, 2x60, 2x150, 10x300")}
                      onChange={(e) => (setDurText(e.target.value), setTimingMsg(null))}
                      onKeyDown={(e) => e.key === "Enter" && applyDurations()}
                    />
                  </label>
                  <button className="secondary-btn" onClick={applyDurations}>
                    {t("Frame-Zeiten übernehmen")}
                  </button>
                  {timingMsg && <p className={timingMsg.ok ? "tool-hint success-text" : "error-banner"}>{timingMsg.text}</p>}
                </details>
              </>
            )}
          </>
        )}
      </Card>

      {dyn && info && !dyn.inMni && (
        <>
          <Card title={<>{t("2 · Bewegungskorrektur")}</>} info={t("Frames ab der Startzeit werden rigide auf die gewählte Referenz registriert; frühere Frames (wenig Signal) übernehmen die Lage des ersten registrierten Frames.")} done={!!info.motion} status={info.motion ? { text: t("✓ korrigiert"), tone: "ok" } : null}>
            <label className="field">
              {t("Registrieren ab (s nach Start)")}
              <input value={fromSec} disabled={!!busy} onChange={(e) => setFromSec(e.target.value)} />
            </label>
            <label className="field">
              {t("Referenz der Bewegungskorrektur")}
              <select value={motionRef} disabled={!!busy} onChange={(e) => setMotionRef(e.target.value)}>
                <option value="sum">{t("Summenbild der registrierten Frames")}</option>
                {info.start.map((s, i) => (
                  <option key={i} value={i}>
                    Frame {i + 1} ({fmt(s / 60, 1)}–{fmt((s + info.duration[i]) / 60, 1)} min)
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary-btn" disabled={!!busy} onClick={() => void motionCorrect()}>
              {t("Bewegung korrigieren")}
            </button>
            {info.motion && (
              <>
                <Chart xLabel={t("Frame-Mitte (min)")} yLabel={t("max. Verschiebung (mm)")} series={[{ label: t("Bewegung"), x: frameMids({ start: minutes(info.start), duration: minutes(info.duration) }), y: info.motion.map((m) => m.maxShiftMm), style: "both", color: "#a78bfa" }]} />
                {maxShift! > 2 && (
                  <InfoText warn details={t("Die Bewegung wurde korrigiert; das Ergebnis bitte im Viewer prüfen (Frames durchblättern).")}>
                    {t("Bewegung bis {v} mm", { v: fmt(maxShift!, 1) })}
                  </InfoText>
                )}
              </>
            )}
          </Card>
          <Card title={<>{t("3 · In den MNI-Raum")}</>} info={
                <>
                  <p>{t("Summenbild → T1 rigide und T1 → MNI affin (wie bei Centiloid), oder ohne MRT affin auf die SPM-PET-Vorlage; danach werden alle Frames übertragen.")}</p>
                  <p>{t("Alternativ im Bereich „Standardraum“ normalisieren (Grundlage T1, PET oder CT): Die dynamische Serie wird dort mit allen anderen Datensätzen übertragen und erscheint hier oben als Serie im MNI-Raum.")}</p>
                  <p>
                    {t("Das Summenbild des Zeitfensters wird registriert; die Transformation gilt für alle Frames. Frühe Frames (z. B. 0–10 min) zeigen meist die Perfusion und passen gut zur SPM-PET-Vorlage, späte Frames die Tracerbindung.")}
                  </p>
                </>
              }>
            <div className="inline-fields hist-export-fields">
              <label className="field">
                {t("Registrierungsbild: Summe von (min)")}
                <input value={regFrom} disabled={!!busy} onChange={(e) => setRegFrom(e.target.value)} />
              </label>
              <label className="field">
                {t("bis (min)")}
                <input value={regTo} placeholder={fmt((info.start.at(-1)! + info.duration.at(-1)!) / 60, 0)} disabled={!!busy} onChange={(e) => setRegTo(e.target.value)} />
              </label>
            </div>
            {!t1Id && (
              <InfoText warn details={t("Ohne MRT deutlich ungenauer (Phantom: Putamen-BP_ND 1,3 statt 1,8) – wenn möglich ein T1 wählen.")}>{t("Ohne MRT ungenauer")}</InfoText>
            )}
            <label className="field">
              T1-MRT
              <select value={t1Id} disabled={!!busy} onChange={(e) => setT1Id(e.target.value)}>
                <option value="">{t("ohne MRT (SPM-PET-Vorlage)")}</option>
                {api.t1s.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-btn" disabled={!!busy} onClick={() => void toMni()}>
              {t("Frames in den MNI-Raum übertragen")}
            </button>
          </Card>
        </>
      )}

      {dyn && info && dyn.inMni && (
        <Card title={<>{t("4 · Referenzregion und Modell")}</>} status={result ? { text: `✓ ${result.model === "patlak" ? "Patlak" : "SRTM"}`, tone: "ok" } : null}>
          <div className="button-row">
            <AtlasPicker busy={api.atlasBusy} onLoad={api.loadCerebra} />
          </div>
          {api.atlases.length === 0 ? (
            <p className="tool-hint">{t("Zuerst einen Hirnatlas laden (CerebrA oder AAL3 im Bereich „Analyse“).")}</p>
          ) : (
            <>
              <label className="field">
                {t("Atlas")}
                <select value={atlas?.id ?? ""} disabled={!!busy} onChange={(e) => setAtlasId(e.target.value)}>
                  {api.atlases.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t("Referenzregion")}
                <select value={preset?.id ?? ""} disabled={!!busy} onChange={(e) => setRefMode(e.target.value)}>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.indices.size} Regionen)
                    </option>
                  ))}
                </select>
              </label>
              <div className="segmented-control" role="group" aria-label={t("Modell")}>
                <button className={model === "srtm" ? "active" : ""} onClick={() => setModel("srtm")}>
                  {t("SRTM (reversibel)")}
                </button>
                <button className={model === "patlak" ? "active" : ""} onClick={() => setModel("patlak")}>
                  {t("Patlak (irreversibel)")}
                </button>
              </div>
              {model === "patlak" ? (
                <label className="field">
                  {t("Startzeit t* der linearen Phase (min)")}
                  <input value={tStar} disabled={!!busy} onChange={(e) => setTStar(e.target.value)} />
                </label>
              ) : (
                <InfoText details={t("SRTM mit Basisfunktionen (Gunn 1997): BP_ND, R1, k2 – Gewichtung nach Frame-Dauer.")}>{t("SRTM (Basisfunktionen)")}</InfoText>
              )}
              <label className="checkbox-field">
                <input type="checkbox" checked={makeMaps} onChange={(e) => setMakeMaps(e.target.checked)} /> Parameterkarten (voxelweise) anlegen
              </label>
              <button className="primary-btn" disabled={!!busy || !preset} onClick={() => void compute()}>
                {t("Berechnen")}
              </button>
            </>
          )}
        </Card>
      )}

      {busy && (
        <section className="card">
          <p className="tool-hint">{busy} …</p>
          {progress !== null && (
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </section>
      )}
      {error && <div className="error-banner">{error}</div>}

      {tacSeries.length > 0 && (
        <Card title={<>{current ? t("Ergebnis · {v} · Referenz {refLabel}", { v: current.model === "patlak" ? "Patlak" : "SRTM", refLabel: current.refLabel }) : t("Zeit-Aktivitäts-Kurve")}</>}>
          <Chart xLabel={t("Zeit (min)")} yLabel={t("Aktivität")} series={tacSeries} />
          {patlakSeries.length > 0 && <Chart xLabel="∫C_ref / C_ref (min)" yLabel="C / C_ref" series={patlakSeries} />}
          {current && (
            <>
              <div className="button-row">
                <button className="secondary-btn" onClick={downloadCsv}>
                  {t("Tabelle + TACs als CSV")}
                </button>
              </div>
              {createdMaps?.dynId === current.dynId && (
                <>
                  <h4 className="subheading">{t("Parameterkarten (neue Datensätze, exportierbar)")}</h4>
                  {createdMaps.maps.map((m) => (
                    <div key={m.id} className="hidden-dataset-row">
                      <span>
                        <strong>{m.label}</strong> – {m.hint}
                      </span>
                      <button className="chip-btn" onClick={() => api.showDataset(m.id)}>
                        {t("einblenden")}
                      </button>
                    </div>
                  ))}
                </>
              )}
              <p className="tool-hint">{t("Zeile anklicken = Kurve und Fit der Region anzeigen.")}</p>
              <BigTable title={t("Kinetik – {v} · Referenz {refLabel}", { v: current.model === "patlak" ? "Patlak" : "SRTM", refLabel: current.refLabel })} onCsv={downloadCsv}>
                <table className="region-table label-stats-table">
                  <thead>
                    <tr>
                      <th>{t("Region")}</th>
                      {current.model === "patlak" ? (
                        <>
                          <th>Ki_ref (1/min)</th>
                          <th>R²</th>
                        </>
                      ) : (
                        <>
                          <th>BP_ND</th>
                          <th>R1</th>
                          <th>R²</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {current.rows.map((r) => (
                      <tr key={r.index} className={r.index === selected ? "reference-row clickable" : "clickable"} onClick={() => setSelected(r.index)}>
                        <td>{r.name}</td>
                        {current.model === "patlak" ? (
                          <>
                            <td>{fmt(r.patlak!.ki, 4)}</td>
                            <td>{fmt(r.patlak!.r2, 3)}</td>
                          </>
                        ) : (
                          <>
                            <td>{fmt(r.srtm!.bp, 3)}</td>
                            <td>{fmt(r.srtm!.r1, 3)}</td>
                            <td>{fmt(r.srtm!.r2, 3)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </BigTable>
            </>
          )}
        </Card>
      )}
    </>
  );
}
