import { useMemo, useState } from "react";
import { formatValue } from "../components/format";
import { umlaut, withPatientId } from "../core/exportName";
import { csvText, csvWithInfo } from "../core/csv";
import type { Mat4 } from "../core/transform";
import type { LoadedDataset } from "../dataset/types";
import { currentNuclide } from "../header/radionuclide";
import { Chart, type ChartSeries } from "../kinetics/Chart";
import { BigTable } from "../ui/BigTable";
import { Card } from "../ui/Card";
import { type CameraProfile, countsToMBq, loadProfiles, parseProfiles, recoveryFor, saveProfiles, timePointFromHeader } from "./calibration";
import { type Placed, measureRegions } from "./dose";
import { DEFAULT_ENERGIES, THERAPY_NUCLIDES, localDepositionDose, nuclideById } from "./nuclideData";
import { DEFAULT_ORGANS, type DosRegionOptions, type DosimetrySetup, bedMono, regionKey } from "./setup";
import { TAC_MODEL_LABELS, type TacFit, type TacModel, fitTac } from "./tacFit";
import { type DvhStats, densityMap, doseFromTia, dvh, parseKernel, regionDoses, voxelTia } from "./voxelDose";

export interface DosEntry {
  id: string;
  label: string;
  dataset: LoadedDataset;
  matrix: Mat4;
  modality: string;
}

export interface DosimetryApi {
  entries: DosEntry[];
  setup: DosimetrySetup;
  onSetup: (update: (s: DosimetrySetup) => DosimetrySetup) => void;
  /** Starts the CT organ segmentation (result appears as a label dataset). */
  segmentCt: (ctId: string) => void;
  segRunning: boolean;
  /** Registers each time point's CT rigidly onto the reference CT and moves its followers along. */
  registerTimePoints: (refCtId: string, pairs: { ctId: string; followers: string[] }[], status: (s: string) => void) => Promise<void>;
  /** Creates (or replaces) the dose map dataset on the grid of the reference SPECT; returns its id. */
  putDoseMap: (refSpectId: string, data: Float32Array, name: string, replaceId?: string) => string;
  showDataset: (id: string) => void;
  onActivity: (label: string | null) => void;
}

const HOUR = 3.6e6;
const fmt = (v: number | undefined, digits = 3) => (v === undefined || !Number.isFinite(v) ? "–" : formatValue(Number(v.toPrecision(digits))));

interface TpView {
  spectId: string;
  label: string;
  ctId?: string;
  tH?: number;
  durationSec?: number;
  decayCorrected: boolean;
  mbqPerCount: number;
  fovMBq?: number;
  pctInjected?: number;
  headerNote: string[];
}

interface RegionRow {
  key: string;
  name: string;
  opts: DosRegionOptions;
  t: number[];
  a: number[];
  massG: number;
  volumeMl: number;
  rc: number;
  fit: TacFit;
  doseGy: number;
  doseSdGy?: number;
  bed?: number;
}

export function DosimetryPanel({ api }: { api: DosimetryApi }) {
  const { setup, entries } = api;
  const set = api.onSetup;
  const [profiles, setProfiles] = useState<CameraProfile[]>(() => loadProfiles());
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [kernelVoxel, setKernelVoxel] = useState("");
  const [kernelUnit, setKernelUnit] = useState<"mGy/MBq·s" | "Gy/MBq·s" | "Gy/Bq·s">("mGy/MBq·s");

  const byId = (id: string | undefined) => entries.find((e) => e.id === id);
  const spectCandidates = entries.filter((e) => !e.dataset.atlas && !e.dataset.template && !e.dataset.derivedFrom && !["CT", "MR"].includes(e.modality) && e.dataset.valueUnit !== "Gy");
  const cts = entries.filter((e) => e.modality === "CT" && !e.dataset.atlas);
  const labelCandidates = entries.filter((e) => e.dataset.atlas);
  const tps = setup.timePoints.filter((tp) => byId(tp.spectId));

  // ── Nuclide and energy ──
  const firstSpect = byId(tps[0]?.spectId);
  const firstHeader = firstSpect?.dataset.source.kind === "dicom" ? firstSpect.dataset.source.files[0].dataSet : undefined;
  const headerNuclide = firstHeader ? currentNuclide(firstHeader).match?.id : undefined;
  const nuclideId = setup.nuclide;
  const nuclide = nuclideById(nuclideId);
  const energy = setup.energyOverride[nuclideId] ?? DEFAULT_ENERGIES[nuclideId]?.electronKeV;
  const energyChecked = setup.energyOverride[nuclideId] !== undefined || DEFAULT_ENERGIES[nuclideId]?.verified;
  const halfLifeH = nuclide ? nuclide.halfLifeSec / 3600 : NaN;

  // ── Injection ──
  const headerInfo = firstHeader ? timePointFromHeader(firstHeader) : undefined;
  const injectionMs = setup.injection.timeMs ?? headerInfo?.injectionMs;
  const injectedMBq = setup.injection.activityMBq ?? headerInfo?.injectedMBq;
  const profile = setup.profile;

  // ── Time points ──
  const tpViews: TpView[] = tps.map((tp) => {
    const e = byId(tp.spectId)!;
    const ds = e.dataset.source.kind === "dicom" ? e.dataset.source.files[0].dataSet : undefined;
    const h = ds ? timePointFromHeader(ds) : undefined;
    const note: string[] = [];
    const tAuto = h?.acquisitionMs !== undefined && injectionMs !== undefined ? (h.acquisitionMs - injectionMs) / HOUR : undefined;
    const tH = tp.tHoursManual ?? tAuto;
    const durationSec = tp.durationSecManual ?? h?.durationSec;
    const decayCorrected = tp.decayCorrected ?? (!!h?.decayCorrection && h.decayCorrection.toUpperCase() !== "NONE");
    if (h?.units && h.units.toUpperCase() !== "CNTS") note.push(`Einheit im Header: ${h.units}`);
    if (decayCorrected && h?.decayCorrection?.toUpperCase() === "ADMIN") note.push("Bild auf Injektion zerfallskorrigiert – Zeitachse prüfen");
    const mbqPerCount = profile && nuclide && durationSec ? countsToMBq(durationSec, profile.cpsPerMBq, nuclide.halfLifeSec, decayCorrected) : NaN;
    const sum = positiveSum(e.dataset.current.data);
    const fovMBq = Number.isFinite(mbqPerCount) ? sum * mbqPerCount : undefined;
    const pctInjected = fovMBq !== undefined && injectedMBq && tH !== undefined && nuclide ? (100 * fovMBq) / (injectedMBq * Math.exp((-Math.LN2 * tH) / halfLifeH)) : undefined;
    return { spectId: tp.spectId, label: e.label, ctId: tp.ctId, tH, durationSec, decayCorrected, mbqPerCount, fovMBq, pctInjected, headerNote: note };
  });

  // ── Regions ──
  const labelNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const ls of setup.labelSets) {
      const e = entries.find((x) => x.id === ls.id);
      for (const n of e?.dataset.atlas?.labels.values() ?? []) names.set(regionKey(n), n);
    }
    return names;
  }, [setup.labelSets, entries]);
  const regionOpts = (key: string): DosRegionOptions =>
    setup.regions[key] ?? { enabled: DEFAULT_ORGANS.includes(key) || key.startsWith("läsion"), model: "auto", recovery: key.startsWith("läsion") };
  const setRegion = (key: string, patch: Partial<DosRegionOptions>) => set((s) => ({ ...s, regions: { ...s.regions, [key]: { ...regionOpts(key), ...patch } } }));

  const rows: RegionRow[] = useMemo(() => {
    if (!nuclide || energy === undefined) return [];
    const out: RegionRow[] = [];
    for (const [key, name] of labelNames) {
      const opts = regionOpts(key);
      if (!opts.enabled) continue;
      const pts = tpViews
        .map((tp) => ({ tH: tp.tH, m: setup.measurements[tp.spectId]?.[key] }))
        .filter((p): p is { tH: number; m: NonNullable<typeof p.m> } => p.tH !== undefined && !!p.m && Number.isFinite(p.m.activityMBq));
      if (!pts.length) continue;
      const volumeMl = pts.reduce((s, p) => s + p.m.volumeMl, 0) / pts.length;
      const massG = pts.reduce((s, p) => s + p.m.massG, 0) / pts.length;
      const rc = opts.recovery ? recoveryFor(profile, volumeMl) : 1;
      const t = pts.map((p) => p.tH);
      const a = pts.map((p) => p.m.activityMBq / rc);
      const fit = fitTac(t, a, opts.model, { physHalfLifeH: halfLifeH, teffH: opts.teffH });
      const doseGy = fit.ok || fit.tia === 0 ? localDepositionDose(fit.tia, energy, massG / 1000) : NaN;
      const doseSdGy = fit.tiaSd !== undefined ? (doseGy * fit.tiaSd) / fit.tia : undefined;
      const kidney = /kidney|niere/i.test(name);
      const bed = kidney && fit.teffH ? bedMono(doseGy, fit.teffH, setup.bed.alphaBeta, setup.bed.repairHalfTimeH) : undefined;
      out.push({ key, name, opts, t, a, massG, volumeMl, rc, fit, doseGy, doseSdGy, bed });
    }
    return out;
  }, [labelNames, setup, tpViews.map((t) => `${t.spectId}:${t.tH}`).join(), energy, nuclide, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ──
  function addTimePoint(id: string, on: boolean) {
    set((s) => {
      if (!on) return { ...s, timePoints: s.timePoints.filter((t) => t.spectId !== id) };
      const e = byId(id);
      const fo = e?.dataset.current.geometry.frameOfReferenceUid;
      const ct = cts.find((c) => fo && c.dataset.current.geometry.frameOfReferenceUid === fo);
      return { ...s, timePoints: [...s.timePoints, { spectId: id, ctId: ct?.id }] };
    });
  }

  function updateTp(id: string, patch: Partial<DosimetrySetup["timePoints"][number]>) {
    set((s) => ({ ...s, timePoints: s.timePoints.map((t) => (t.spectId === id ? { ...t, ...patch } : t)) }));
  }

  function toggleLabelSet(id: string, on: boolean) {
    set((s) => {
      if (!on) return { ...s, labelSets: s.labelSets.filter((l) => l.id !== id) };
      const e = byId(id);
      const fo = e?.dataset.current.geometry.frameOfReferenceUid;
      const tp = s.timePoints.find((t) => {
        const ct = byId(t.ctId), sp = byId(t.spectId);
        return fo && (ct?.dataset.current.geometry.frameOfReferenceUid === fo || sp?.dataset.current.geometry.frameOfReferenceUid === fo);
      });
      return { ...s, labelSets: [...s.labelSets, { id, tp: s.timePoints.length > 1 && tp ? tp.spectId : "all" }] };
    });
  }

  function saveProfile(p: CameraProfile) {
    const list = [...profiles.filter((x) => x.id !== p.id), p];
    setProfiles(list);
    saveProfiles(list);
    set((s) => ({ ...s, profile: p }));
  }

  async function measure() {
    if (!tpViews.length) return;
    setBusy("Aktivitäten messen");
    setError(null);
    api.onActivity("Aktivitäten messen");
    try {
      const enabledKeys = new Set([...labelNames.keys()].filter((k) => regionOpts(k).enabled));
      const measurements: DosimetrySetup["measurements"] = {};
      for (const [n, tp] of tpViews.entries()) {
        setStatus(`Zeitpunkt ${n + 1}/${tpViews.length}`);
        await new Promise((r) => setTimeout(r, 10));
        if (!Number.isFinite(tp.mbqPerCount)) throw new Error(`${tp.label}: Kalibrierung unvollständig (Kamera-Profil, Aufnahmedauer).`);
        const spect = byId(tp.spectId)!;
        const ct = byId(tp.ctId);
        const sets = setup.labelSets.filter((l) => l.tp === tp.spectId || l.tp === "all").sort((a) => (a.tp === "all" ? 1 : -1));
        const res: Record<string, ReturnType<typeof measureRegions> extends Map<number, infer R> ? R & { name: string } : never> = {};
        for (const ls of sets) {
          const le = byId(ls.id);
          const atlas = le?.dataset.atlas;
          if (!le || !atlas) continue;
          const only = new Set([...atlas.labels].filter(([, name]) => enabledKeys.has(regionKey(name)) && !res[regionKey(name)]).map(([id]) => id));
          if (!only.size) continue;
          const m = measureRegions(place(le), place(spect), tp.mbqPerCount, ct ? place(ct) : undefined, only);
          for (const [id, r] of m) {
            const name = atlas.labels.get(id) ?? String(id);
            res[regionKey(name)] = { ...r, name };
          }
        }
        measurements[tp.spectId] = res;
      }
      set((s) => ({ ...s, measurements }));
      setStatus(`Gemessen: ${Object.values(measurements).reduce((s, m) => s + Object.keys(m).length, 0)} Regionen über ${tpViews.length} Zeitpunkt(e).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(null);
      api.onActivity(null);
    }
  }

  async function register() {
    const ref = tpViews[0];
    if (!ref?.ctId) return;
    setBusy("Registrierung");
    setError(null);
    api.onActivity("Zeitpunkte registrieren");
    try {
      const pairs = tpViews.slice(1).filter((tp) => tp.ctId).map((tp) => ({
        ctId: tp.ctId!,
        followers: [tp.spectId, ...setup.labelSets.filter((l) => l.tp === tp.spectId).map((l) => l.id)],
      }));
      await api.registerTimePoints(ref.ctId, pairs, setStatus);
      setStatus(`${pairs.length} Zeitpunkt(e) auf das CT von ${ref.label} registriert. Bitte die Überlagerung prüfen.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      api.onActivity(null);
    }
  }

  async function doseMap() {
    const ref = tpViews[0];
    if (!ref || !nuclide || energy === undefined) return;
    setBusy("Dosiskarte");
    setError(null);
    api.onActivity("Dosiskarte");
    try {
      const vtps = tpViews.map((tp) => {
        if (tp.tH === undefined || !Number.isFinite(tp.mbqPerCount)) throw new Error(`${tp.label}: Zeitpunkt oder Kalibrierung fehlt.`);
        return { spect: place(byId(tp.spectId)!), mbqPerCount: tp.mbqPerCount, tH: tp.tH };
      });
      const refPlaced = place(byId(ref.spectId)!);
      const kernel = setup.voxel.kernel;
      if (kernel && Math.abs(kernel.voxelMm - refPlaced.volume.geometry.spacing[0]) / kernel.voxelMm > 0.05)
        throw new Error(`Kernel-Voxelgröße ${kernel.voxelMm} mm passt nicht zur SPECT-Voxelgröße ${refPlaced.volume.geometry.spacing[0].toFixed(2)} mm.`);
      const tia = await voxelTia(refPlaced, vtps, { physHalfLifeH: halfLifeH, electronKeV: energy, method: setup.voxel.method, onProgress: (f) => setStatus(`Zeitintegral ${Math.round(f * 100)} %`) });
      setStatus(kernel ? "Kernel-Faltung …" : "Dosis …");
      await new Promise((r) => setTimeout(r, 10));
      const refCt = byId(ref.ctId);
      const rho = densityMap(refPlaced, refCt ? place(refCt) : undefined);
      const dose = doseFromTia(tia, rho, refPlaced.volume, { electronKeV: energy, kernel });
      const name = `Dosis (Gy) · ${nuclideId} · ${kernel ? "Kernel" : "lokal"}`;
      const id = api.putDoseMap(ref.spectId, dose, name, setup.voxel.doseId && byId(setup.voxel.doseId) ? setup.voxel.doseId : undefined);
      set((s) => ({ ...s, voxel: { ...s.voxel, doseId: id } }));
      let max = 0;
      for (const v of dose) if (v > max) max = v;
      setStatus(`Dosiskarte erstellt (Maximum ${fmt(max)} Gy).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(null);
      api.onActivity(null);
    }
  }

  async function loadKernel(file: File) {
    setError(null);
    try {
      const voxel = Number(kernelVoxel.replace(",", "."));
      if (!(voxel > 0)) throw new Error("Bitte zuerst die Voxelgröße des Kernels (mm) eintragen.");
      const kernel = parseKernel(await file.text(), file.name, voxel, kernelUnit);
      set((s) => ({ ...s, voxel: { ...s.voxel, kernel } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── DVH from the dose map ──
  const doseEntry = byId(setup.voxel.doseId);
  const dvhs = useMemo(() => {
    const out = new Map<string, DvhStats>();
    if (!doseEntry) return out;
    const refTp = tpViews[0]?.spectId;
    for (const ls of setup.labelSets.filter((l) => l.tp === "all" || l.tp === refTp)) {
      const le = entries.find((e) => e.id === ls.id);
      const atlas = le?.dataset.atlas;
      if (!le || !atlas) continue;
      const byKey = new Map<string, Set<number>>();
      for (const [id, name] of atlas.labels) {
        const key = regionKey(name);
        if (!regionOpts(key).enabled || out.has(key)) continue;
        byKey.set(key, new Set([...(byKey.get(key) ?? []), id]));
      }
      for (const [key, ids] of byKey) {
        const s = dvh(regionDoses(place(le), place(doseEntry), ids));
        if (s) out.set(key, s);
      }
    }
    return out;
  }, [doseEntry?.dataset.current, setup.labelSets, setup.regions]); // eslint-disable-line react-hooks/exhaustive-deps

  function downloadCsv() {
    const f = (v: number | undefined, d = 4) => (v === undefined || !Number.isFinite(v) ? "" : v.toFixed(d).replace(".", ","));
    const sep = ";";
    const maxTp = Math.max(0, ...rows.map((r) => r.t.length));
    const head = ["Region", "Volumen_ml", "Masse_g", "RC", ...Array.from({ length: maxTp }, (_, i) => [`t${i + 1}_h`, `A${i + 1}_MBq`]).flat(), "Modell", "Teff_h", "TIA_MBq_h", "TIA_SD", "Dosis_Gy", "Dosis_SD_Gy", "BED_Gy", "Dmean_Voxel_Gy", "D2_Gy", "D50_Gy", "D98_Gy"];
    const lines = rows.map((r) => {
      const d = dvhs.get(r.key);
      const pts = Array.from({ length: maxTp }, (_, i) => [f(r.t[i], 2), f(r.a[i])]).flat();
      return [csvText(r.name), f(r.volumeMl, 2), f(r.massG, 2), f(r.rc, 3), ...pts, csvText(TAC_MODEL_LABELS[r.fit.model]), f(r.fit.teffH, 2), f(r.fit.tia, 2), f(r.fit.tiaSd, 2), f(r.doseGy), f(r.doseSdGy), f(r.bed), f(d?.mean), f(d?.d2), f(d?.d50), f(d?.d98)].join(sep);
    });
    const csv = csvWithInfo([head.join(sep), ...lines], [
      ["Nuklid", nuclideId],
      ["Elektronenenergie keV/Zerfall", String(energy ?? "")],
      ["Kamera-Profil", profile ? `${profile.name} (${profile.cpsPerMBq} cps/MBq)` : ""],
      ["Injektion", injectionMs ? new Date(injectionMs).toLocaleString("de-DE") : ""],
      ["Injizierte Aktivität MBq", String(injectedMBq ?? "")],
      ["Methode", "Lokale Energiedeposition der Elektronen (Organ/Läsion); Voxelkarte: " + (setup.voxel.kernel ? `Kernel ${setup.voxel.kernel.name}` : "lokal")],
      ["Hinweis", "Forschungswerkzeug, kein Medizinprodukt"],
    ]);
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = withPatientId(`Dosimetrie_${nuclideId.replace(/[äöüÄÖÜß]/g, umlaut)}.csv`);
    a.click();
    URL.revokeObjectURL(url);
  }

  const sel = rows.find((r) => r.key === selected) ?? rows[0];
  const chart: ChartSeries[] = sel
    ? (() => {
        const tMax = Math.max(...sel.t, sel.fit.teffH ?? 0) * 2;
        const xs = Array.from({ length: 80 }, (_, i) => (tMax * i) / 79);
        return [
          { label: "Messung", x: sel.t, y: sel.a, style: "points" as const, color: "#e8590c" },
          { label: TAC_MODEL_LABELS[sel.fit.model], x: xs, y: xs.map(sel.fit.curve), style: "line" as const, color: "#7c6cf0" },
        ];
      })()
    : [];
  const selDvh = sel ? dvhs.get(sel.key) : undefined;

  const usedTpIds = new Set(tps.map((t) => t.spectId));

  return (
    <>
      <p className="tool-hint">
        Forschungswerkzeug, kein zertifiziertes Medizinprodukt. Grundlage: quantitative SPECT vom Gerät (OSEM mit Schwächungs-, Streu- und
        Auflösungskorrektur) in Counts; die SPECT-Rekonstruktion dieser App ist dafür nicht geeignet.
      </p>

      <Card title={<>Zeitpunkte</>} status={tps.length ? { text: `${tps.length}`, tone: "info" } : null} persistKey="dos-tp"
        info="SPECT-Datensätze der Therapie (1–4 Zeitpunkte) mit dem CT derselben Aufnahme. Der Zeitpunkt nach Injektion wird aus Aufnahme- und Injektionszeit im DICOM-Header berechnet und kann überschrieben werden; ebenso die Aufnahmedauer (Projektionen × Zeit pro Projektion × Detektoren).">
        {spectCandidates.length === 0 && <p className="tool-hint">Erst SPECT-Daten (und die zugehörigen CTs) laden.</p>}
        <div className="imcalc-list export-list">
          {spectCandidates.map((e) => (
            <label key={e.id} className="checkbox-field">
              <input type="checkbox" checked={usedTpIds.has(e.id)} disabled={!!busy} onChange={(ev) => addTimePoint(e.id, ev.target.checked)} />
              <span className="export-item-name">{e.label}</span>
              <em className="export-item-grid">{e.modality}</em>
            </label>
          ))}
        </div>
        <div className="field-row">
          <label className="field">
            Injektion (Datum/Zeit)
            <input
              type="datetime-local"
              value={injectionMs ? toLocalInput(injectionMs) : ""}
              onChange={(e) => set((s) => ({ ...s, injection: { ...s.injection, timeMs: e.target.value ? new Date(e.target.value).getTime() : undefined } }))}
            />
          </label>
          <label className="field">
            Aktivität (MBq)
            <input type="text" inputMode="decimal" value={injectedMBq ?? ""} onChange={(e) => set((s) => ({ ...s, injection: { ...s.injection, activityMBq: numOrUndef(e.target.value) } }))} />
          </label>
        </div>
        {tpViews.map((tp, n) => (
          <div key={tp.spectId} className="dos-tp">
            <strong>
              {n + 1}. {tp.label}
            </strong>
            <div className="field-row three">
              <label className="field">
                CT
                <select value={tp.ctId ?? ""} onChange={(e) => updateTp(tp.spectId, { ctId: e.target.value || undefined })}>
                  <option value="">– keins –</option>
                  {cts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                t p.i. (h)
                <input type="text" inputMode="decimal" placeholder={tp.tH !== undefined ? tp.tH.toFixed(2) : "fehlt"} value={setup.timePoints.find((t) => t.spectId === tp.spectId)?.tHoursManual ?? ""} onChange={(e) => updateTp(tp.spectId, { tHoursManual: numOrUndef(e.target.value) })} />
              </label>
              <label className="field">
                Dauer (s)
                <input type="text" inputMode="decimal" placeholder={tp.durationSec !== undefined ? String(Math.round(tp.durationSec)) : "fehlt"} value={setup.timePoints.find((t) => t.spectId === tp.spectId)?.durationSecManual ?? ""} onChange={(e) => updateTp(tp.spectId, { durationSecManual: numOrUndef(e.target.value) })} />
              </label>
            </div>
            <label className="checkbox-field">
              <input type="checkbox" checked={tp.decayCorrected} onChange={(e) => updateTp(tp.spectId, { decayCorrected: e.target.checked })} />
              <span>Bild bereits zerfallskorrigiert (auf Aufnahmebeginn)</span>
            </label>
            <p className="tool-hint">
              t = {fmt(tp.tH)} h · Dauer {fmt(tp.durationSec)} s · Sichtfeld {fmt(tp.fovMBq)} MBq
              {tp.pctInjected !== undefined ? ` (${fmt(tp.pctInjected)} % der injizierten Aktivität)` : ""}
              {tp.headerNote.length ? ` · ${tp.headerNote.join(" · ")}` : ""}
            </p>
            {tp.ctId && (
              <button className="secondary-btn" disabled={api.segRunning} onClick={() => api.segmentCt(tp.ctId!)}>
                {api.segRunning ? "Segmentierung läuft …" : "Organe auf diesem CT segmentieren"}
              </button>
            )}
          </div>
        ))}
        {tpViews.length > 1 && (
          <>
            <button className="secondary-btn" disabled={!!busy || !tpViews[0].ctId} onClick={() => void register()}>
              Zeitpunkte registrieren (CT → CT von Zeitpunkt 1)
            </button>
            <p className="tool-hint">Rigide CT-CT-Registrierung; SPECT und Labelbilder des Zeitpunkts werden mitbewegt. Nötig für Voxel-Dosiskarten und für Regionen, die für alle Zeitpunkte gelten.</p>
          </>
        )}
      </Card>

      <Card title={<>Nuklid und Kalibrierung</>} persistKey="dos-cal" status={profile ? { text: profile.name, tone: "ok" } : { text: "fehlt", tone: "warn" }}
        info="Kalibrierfaktor der Kamerakonfiguration (Kamera, Kollimator, Energiefenster, Rekonstruktion) in cps/MBq: Counts im SPECT / (Aufnahmedauer × Faktor) = MBq. Der Zerfall während der Aufnahme wird korrigiert. Recovery-Koeffizienten (Kugelphantom) korrigieren den Partialvolumeneffekt kleiner Läsionen.">
        <div className="field-row">
          <label className="field">
            Nuklid{headerNuclide && headerNuclide !== nuclideId ? ` (Header: ${headerNuclide})` : ""}
            <select value={nuclideId} onChange={(e) => set((s) => ({ ...s, nuclide: e.target.value }))}>
              {THERAPY_NUCLIDES.map((n) => (
                <option key={n} value={n}>
                  {n} – T½ {nuclideById(n)?.halfLifeText}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Elektronen (keV/Zerfall)
            <input type="text" inputMode="decimal" placeholder={String(DEFAULT_ENERGIES[nuclideId]?.electronKeV ?? "")} value={setup.energyOverride[nuclideId] ?? ""}
              onChange={(e) => set((s) => {
                const v = numOrUndef(e.target.value);
                const o = { ...s.energyOverride };
                if (v === undefined) delete o[nuclideId];
                else o[nuclideId] = v;
                return { ...s, energyOverride: o };
              })} />
          </label>
        </div>
        {!energyChecked && <p className="tool-hint tool-warning">Vorgabewert {DEFAULT_ENERGIES[nuclideId]?.electronKeV} keV ist ungeprüft – bitte gegen ICRP 107 (oder NNDC NuDat) prüfen und eintragen.</p>}
        {DEFAULT_ENERGIES[nuclideId] && (
          <p className="tool-hint">
            {setup.energyOverride[nuclideId] !== undefined ? `Eigener Wert; Vorgabe ${DEFAULT_ENERGIES[nuclideId].electronKeV} keV. ` : ""}
            Elektronen {DEFAULT_ENERGIES[nuclideId].electronKeV} keV/Zerfall
            {DEFAULT_ENERGIES[nuclideId].betaKeV !== undefined ? ` (β⁻ ${DEFAULT_ENERGIES[nuclideId].betaKeV} keV)` : ""}
            {DEFAULT_ENERGIES[nuclideId].photonKeV !== undefined ? `, Photonen ${DEFAULT_ENERGIES[nuclideId].photonKeV} keV/Zerfall (nur mit Kernel berücksichtigt)` : ""} · Quelle: {DEFAULT_ENERGIES[nuclideId].source}
          </p>
        )}
        <ProfileEditor profiles={profiles} current={profile} nuclide={nuclideId} onSelect={(p) => set((s) => ({ ...s, profile: p }))} onSave={saveProfile}
          onDelete={(id) => {
            const list = profiles.filter((p) => p.id !== id);
            setProfiles(list);
            saveProfiles(list);
          }}
          onImport={(list) => {
            const merged = [...profiles.filter((p) => !list.some((q) => q.id === p.id)), ...list];
            setProfiles(merged);
            saveProfiles(merged);
          }} />
      </Card>

      <Card title={<>Regionen</>} persistKey="dos-reg" status={labelNames.size ? { text: `${[...labelNames.keys()].filter((k) => regionOpts(k).enabled).length} aktiv`, tone: "info" } : null}
        info="Labelbilder (CT-Organsegmentierung, Läsionen, eigene Segmentierungen). Ein Labelbild gilt für seinen Zeitpunkt oder – nach der Registrierung – für alle Zeitpunkte. Regionen gleichen Namens werden über die Zeitpunkte verbunden. Speichel- und Tränendrüsen sind nicht im CT-Modell: als eigene Segmentierung oder VOI laden.">
        {labelCandidates.length === 0 && <p className="tool-hint">Noch keine Labelbilder: Organe auf dem CT segmentieren (oben) oder Läsionen unter Tumorlast.</p>}
        {labelCandidates.map((e) => {
          const ls = setup.labelSets.find((l) => l.id === e.id);
          return (
            <div key={e.id} className="checkbox-field">
              <input type="checkbox" checked={!!ls} onChange={(ev) => toggleLabelSet(e.id, ev.target.checked)} />
              <span className="export-item-name">{e.label}</span>
              {ls && (
                <select value={ls.tp} onChange={(ev) => set((s) => ({ ...s, labelSets: s.labelSets.map((l) => (l.id === e.id ? { ...l, tp: ev.target.value } : l)) }))}>
                  <option value="all">alle Zeitpunkte</option>
                  {tpViews.map((tp, n) => (
                    <option key={tp.spectId} value={tp.spectId}>
                      Zeitpunkt {n + 1}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
        {labelNames.size > 0 && (
          <div className="imcalc-list export-list dos-regions">
            {[...labelNames].sort((a, b) => Number(regionOpts(b[0]).enabled) - Number(regionOpts(a[0]).enabled) || a[1].localeCompare(b[1])).map(([key, name]) => {
              const o = regionOpts(key);
              return (
                <label key={key} className="checkbox-field">
                  <input type="checkbox" checked={o.enabled} onChange={(e) => setRegion(key, { enabled: e.target.checked })} />
                  <span className="export-item-name">{name}</span>
                  {o.enabled && (
                    <em className="export-item-grid">
                      <label title="Recovery-Koeffizient anwenden">
                        <input type="checkbox" checked={o.recovery} onChange={(e) => setRegion(key, { recovery: e.target.checked })} /> RC
                      </label>
                    </em>
                  )}
                </label>
              );
            })}
          </div>
        )}
        <button className="primary-btn" disabled={!!busy || !tpViews.length || !setup.labelSets.length || !profile} onClick={() => void measure()}>
          Aktivitäten messen
        </button>
        {!profile && <p className="tool-hint">Kamera-Profil fehlt (Nuklid und Kalibrierung).</p>}
      </Card>

      <Card title={<>Kurven und Dosis</>} persistKey="dos-res" status={rows.length ? { text: `${rows.length} Regionen`, tone: "ok" } : null}
        info="Je Region: Aktivität (MBq, ggf. durch den Recovery-Koeffizienten geteilt) über der Zeit, Fit und zeitintegrierte Aktivität (TIA). Automatisch: 1 Zeitpunkt → Hänscheid (bzw. Madsen mit T_eff), 2 → monoexponentiell, ≥ 3 → biexponentiell mit Aufnahmephase, wenn die Aktivität zwischen den ersten Zeitpunkten noch steigt, sonst monoexponentiell. Die Auswaschung ist nie langsamer als der physikalische Zerfall. Dosis = TIA × Elektronenenergie / Masse (lokale Energiedeposition; Masse aus CT-Dichte). Nieren: BED für monoexponentielle Auswaschung.">
        {rows.length === 0 ? (
          <p className="tool-hint">Noch keine Messwerte: Zeitpunkte, Kalibrierung und Regionen festlegen, dann „Aktivitäten messen“.</p>
        ) : (
          <>
            {sel && (
              <>
                <Chart series={chart} xLabel="Zeit p.i. (h)" yLabel={`${sel.name} (MBq)`} />
                <div className="field-row">
                  <label className="field">
                    Modell ({sel.name})
                    <select value={sel.opts.model} onChange={(e) => setRegion(sel.key, { model: e.target.value as TacModel | "auto" })}>
                      <option value="auto">automatisch</option>
                      {(Object.keys(TAC_MODEL_LABELS) as TacModel[]).map((m) => (
                        <option key={m} value={m}>
                          {TAC_MODEL_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    T_eff Population (h)
                    <input type="text" inputMode="decimal" placeholder="für Madsen" value={sel.opts.teffH ?? ""} onChange={(e) => setRegion(sel.key, { teffH: numOrUndef(e.target.value) })} />
                  </label>
                </div>
                {sel.fit.note && <p className="tool-hint">{sel.fit.note}</p>}
                {selDvh && <Chart series={[{ label: "DVH", x: selDvh.curve.dose, y: selDvh.curve.volumePct, style: "line", color: "#2f9e44" }]} xLabel="Dosis (Gy)" yLabel={`${sel.name}: Volumen (%)`} />}
              </>
            )}
            <p className="tool-hint">Zeile anklicken = Kurve, Fit und DVH der Region.</p>
            <BigTable title={`Dosimetrie · ${nuclideId}`} onCsv={downloadCsv}>
              <table className="region-table label-stats-table">
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>Masse (g)</th>
                    <th>Modell</th>
                    <th>T_eff (h)</th>
                    <th>TIA (MBq·h)</th>
                    <th>Dosis (Gy)</th>
                    <th>BED (Gy)</th>
                    <th>D2/D50/D98 (Gy)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const d = dvhs.get(r.key);
                    return (
                      <tr key={r.key} className={r.key === sel?.key ? "reference-row clickable" : "clickable"} onClick={() => setSelected(r.key)}>
                        <td>{r.name}</td>
                        <td>{fmt(r.massG)}</td>
                        <td>{TAC_MODEL_LABELS[r.fit.model]}</td>
                        <td>{fmt(r.fit.teffH)}</td>
                        <td>
                          {fmt(r.fit.tia)}
                          {r.fit.tiaSd !== undefined ? ` ± ${fmt(r.fit.tiaSd, 2)}` : ""}
                        </td>
                        <td>
                          {fmt(r.doseGy)}
                          {r.doseSdGy !== undefined ? ` ± ${fmt(r.doseSdGy, 2)}` : ""}
                        </td>
                        <td>{fmt(r.bed)}</td>
                        <td>{d ? `${fmt(d.d2)} / ${fmt(d.d50)} / ${fmt(d.d98)}` : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </BigTable>
            <div className="field-row">
              <label className="field">
                Niere α/β (Gy)
                <input type="text" inputMode="decimal" value={setup.bed.alphaBeta} onChange={(e) => set((s) => ({ ...s, bed: { ...s.bed, alphaBeta: numOrUndef(e.target.value) ?? s.bed.alphaBeta } }))} />
              </label>
              <label className="field">
                Reparatur-T½ (h)
                <input type="text" inputMode="decimal" value={setup.bed.repairHalfTimeH} onChange={(e) => set((s) => ({ ...s, bed: { ...s.bed, repairHalfTimeH: numOrUndef(e.target.value) ?? s.bed.repairHalfTimeH } }))} />
              </label>
            </div>
          </>
        )}
      </Card>

      <Card title={<>Voxel-Dosiskarte</>} persistKey="dos-voxel" defaultOpen={false} status={doseEntry ? { text: "erstellt", tone: "ok" } : null}
        info="Dosiskarte auf dem Raster des SPECT von Zeitpunkt 1. Alle Zeitpunkte werden über die Registrierung abgetastet; je Voxel Trapez + Ausläufer oder monoexponentieller Fit (log-linear), bei einem Zeitpunkt Hänscheid. Dosis: lokale Energiedeposition der Elektronen mit CT-Dichte oder Faltung mit einem geladenen Dosis-Voxel-Kernel (enthält auch Photonen; Dichte-Skalierung ρ_Wasser/ρ). DVH je Region aus der Karte.">
        <div className="field-row">
          <label className="field">
            Integration je Voxel
            <select value={setup.voxel.method} onChange={(e) => set((s) => ({ ...s, voxel: { ...s.voxel, method: e.target.value as "trapezoid" | "mono" } }))}>
              <option value="mono">Monoexponentiell (log-linear)</option>
              <option value="trapezoid">Trapez + Ausläufer</option>
            </select>
          </label>
        </div>
        <div className="field-row three">
          <label className="field">
            Kernel-Voxel (mm)
            <input type="text" inputMode="decimal" placeholder={tpViews[0] ? byId(tpViews[0].spectId)?.dataset.current.geometry.spacing[0].toFixed(2) : ""} value={kernelVoxel} onChange={(e) => setKernelVoxel(e.target.value)} />
          </label>
          <label className="field">
            Einheit
            <select value={kernelUnit} onChange={(e) => setKernelUnit(e.target.value as typeof kernelUnit)}>
              <option value="mGy/MBq·s">mGy/(MBq·s)</option>
              <option value="Gy/MBq·s">Gy/(MBq·s)</option>
              <option value="Gy/Bq·s">Gy/(Bq·s)</option>
            </select>
          </label>
          <label className="field">
            Kernel-Tabelle
            <input type="file" accept=".txt,.csv,.dat,text/plain" onChange={(e) => e.target.files?.[0] && void loadKernel(e.target.files[0])} />
          </label>
        </div>
        <p className="tool-hint">
          {setup.voxel.kernel ? (
            <>
              Kernel: {setup.voxel.kernel.name} ({setup.voxel.kernel.voxelMm} mm, Radius {setup.voxel.kernel.radius} Voxel){" "}
              <button className="link-btn" onClick={() => set((s) => ({ ...s, voxel: { ...s.voxel, kernel: undefined } }))}>
                entfernen
              </button>
            </>
          ) : (
            <>Ohne Kernel: lokale Energiedeposition (Lu-177, Tb-161; für I-131 und Y-90 fehlen dann Photonen bzw. die β-Reichweite). Kernel-Tabelle: Zeilen „i j k S“ (z. B. Voxel-S-Werte nach Lanconelli 2012 für die passende Voxelgröße).</>
          )}
        </p>
        <button className="primary-btn" disabled={!!busy || !tpViews.length || !profile || energy === undefined} onClick={() => void doseMap()}>
          {doseEntry ? "Dosiskarte neu berechnen" : "Dosiskarte berechnen"}
        </button>
        {doseEntry && (
          <button className="secondary-btn" onClick={() => api.showDataset(doseEntry.id)}>
            Dosiskarte anzeigen
          </button>
        )}
      </Card>

      {busy && <p className="tool-hint">{busy} … {status}</p>}
      {!busy && status && <p className="tool-hint">{status}</p>}
      {error && <div className="error-banner">{error}</div>}
    </>
  );

  function place(e: DosEntry): Placed {
    return { volume: e.dataset.current, matrix: e.matrix };
  }
}

const sums = new WeakMap<Float32Array, number>();
/** Sum of the positive values (cached per array: computed once per dataset version). */
function positiveSum(data: Float32Array): number {
  let s = sums.get(data);
  if (s === undefined) {
    s = 0;
    for (const v of data) if (v > 0) s += v;
    sums.set(data, s);
  }
  return s;
}

function numOrUndef(s: string): number | undefined {
  const v = Number(s.replace(",", ".").trim());
  return s.trim() === "" || !Number.isFinite(v) ? undefined : v;
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Camera profiles: choose, edit, import/export (stored in the browser; the chosen one also in the project). */
function ProfileEditor({
  profiles,
  current,
  nuclide,
  onSelect,
  onSave,
  onDelete,
  onImport,
}: {
  profiles: CameraProfile[];
  current?: CameraProfile;
  nuclide: string;
  onSelect: (p: CameraProfile | undefined) => void;
  onSave: (p: CameraProfile) => void;
  onDelete: (id: string) => void;
  onImport: (list: CameraProfile[]) => void;
}) {
  const [draft, setDraft] = useState<{ name: string; cps: string; collimator: string; window: string; rc: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const list = current && !profiles.some((p) => p.id === current.id) ? [...profiles, current] : profiles;
  const edit = (p?: CameraProfile) =>
    setDraft({
      name: p?.name ?? "",
      cps: p ? String(p.cpsPerMBq) : "",
      collimator: p?.collimator ?? "",
      window: p?.window ?? "",
      rc: (p?.recovery ?? []).map((r) => `${r.volumeMl}:${r.rc}`).join("; "),
    });
  function commit() {
    if (!draft) return;
    const cps = Number(draft.cps.replace(",", "."));
    if (!draft.name.trim() || !(cps > 0)) return setErr("Name und Kalibrierfaktor (cps/MBq > 0) angeben.");
    const recovery = draft.rc
      .split(/[;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [v, r] = s.split(/[:=\s]+/).map((x) => Number(x.replace(",", ".")));
        return { volumeMl: v, rc: r };
      });
    if (recovery.some((r) => !(r.volumeMl > 0) || !(r.rc > 0) || r.rc > 1.5)) return setErr("Recovery-Koeffizienten als „Volumen_ml:RC; …“ angeben, z. B. „0,5:0,3; 26,5:0,8“.");
    setErr(null);
    onSave({ id: current && draft.name === current.name ? current.id : `cam${Date.now()}`, name: draft.name.trim(), nuclide, cpsPerMBq: cps, collimator: draft.collimator || undefined, window: draft.window || undefined, recovery: recovery.length ? recovery : undefined });
    setDraft(null);
  }
  return (
    <>
      <div className="field-row">
        <label className="field">
          Kamera-Profil
          <select value={current?.id ?? ""} onChange={(e) => onSelect(list.find((p) => p.id === e.target.value))}>
            <option value="">– wählen –</option>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.nuclide} · {p.cpsPerMBq} cps/MBq
              </option>
            ))}
          </select>
        </label>
      </div>
      {current && current.nuclide !== nuclide && <p className="tool-hint tool-warning">Profil ist für {current.nuclide} kalibriert, gewählt ist {nuclide}.</p>}
      {current && (
        <p className="tool-hint">
          {current.collimator ? `Kollimator ${current.collimator} · ` : ""}
          {current.window ? `Fenster ${current.window} · ` : ""}
          {current.recovery?.length ? `RC: ${current.recovery.map((r) => `${r.volumeMl} ml → ${r.rc}`).join(", ")}` : "keine Recovery-Koeffizienten"}
        </p>
      )}
      {draft ? (
        <div className="dos-profile">
          <div className="field-row">
            <label className="field">
              Name
              <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field">
              cps/MBq
              <input type="text" inputMode="decimal" value={draft.cps} onChange={(e) => setDraft({ ...draft, cps: e.target.value })} />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              Kollimator
              <input type="text" value={draft.collimator} onChange={(e) => setDraft({ ...draft, collimator: e.target.value })} />
            </label>
            <label className="field">
              Energiefenster
              <input type="text" value={draft.window} onChange={(e) => setDraft({ ...draft, window: e.target.value })} />
            </label>
          </div>
          <label className="field">
            Recovery (Volumen ml : RC; …)
            <input type="text" value={draft.rc} placeholder="0,5:0,3; 1,2:0,45; 26,5:0,8" onChange={(e) => setDraft({ ...draft, rc: e.target.value })} />
          </label>
          <div className="button-row">
            <button className="primary-btn" onClick={commit}>
              Profil speichern
            </button>
            <button className="secondary-btn" onClick={() => setDraft(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <div className="chip-row">
          <button className="chip-btn" onClick={() => edit()}>
            Neu
          </button>
          {current && (
            <button className="chip-btn" onClick={() => edit(current)}>
              Ändern
            </button>
          )}
          {current && (
            <button className="chip-btn" onClick={() => window.confirm(`Profil „${current.name}“ löschen?`) && (onDelete(current.id), onSelect(undefined))}>
              Löschen
            </button>
          )}
        </div>
      )}
      <div className="button-row">
        <label className="link-btn">
          Profile importieren
          <input type="file" accept=".json,application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              onImport(parseProfiles(await f.text()));
              setErr(null);
            } catch (x) {
              setErr(x instanceof Error ? x.message : String(x));
            }
          }} />
        </label>
        <button className="link-btn" disabled={!list.length} onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify({ format: "recon-studio-camera-profiles", profiles: list }, null, 2)], { type: "application/json" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = "Kamera-Profile.json";
          a.click();
          URL.revokeObjectURL(url);
        }}>
          Profile exportieren
        </button>
      </div>
      {err && <p className="tool-hint tool-warning">{err}</p>}
    </>
  );
}
