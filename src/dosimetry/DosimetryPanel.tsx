import { useEffect, useMemo, useState } from "react";
import { formatValue } from "../components/format";
import { umlaut, withPatientId } from "../core/exportName";
import { csvText, csvWithInfo } from "../core/csv";
import type { Mat4 } from "../core/transform";
import type { LoadedDataset } from "../dataset/types";
import { currentNuclide } from "../header/radionuclide";
import { shortName } from "../dataset/describe";
import { Chart, type ChartSeries } from "../kinetics/Chart";
import { BigTable } from "../ui/BigTable";
import { Card } from "../ui/Card";
import { InfoText } from "../ui/Info";
import { type CameraProfile, countsToMBq, loadProfiles, parseProfiles, recoveryFor, saveProfiles, timePointFromHeader } from "./calibration";
import { type Placed, measureRegions } from "./dose";
import { DEFAULT_ENERGIES, THERAPY_NUCLIDES, localDepositionDose, nuclideById } from "./nuclideData";
import { DEFAULT_ORGANS, type DosRegionOptions, type DosimetrySetup, bedMono, regionKey } from "./setup";
import { PhantomCalibration } from "./PhantomCalibration";
import { TAC_MODEL_LABELS, type TacFit, type TacModel, fitTac } from "./tacFit";
import { type DvhStats, densityMap, doseFromTia, dvh, parseKernel, regionDoses, voxelTia } from "./voxelDose";
import { type SessionItem, acquisitionMs, fmtDateTime, groupSessions, hoursPi, studyUidOf } from "./sessions";
import { type TpCardView, type UnassignedItem, TimePointsCard } from "./TimePointsCard";

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
  /** Starts the CT organ segmentation with a model (result appears as a label dataset). */
  segmentCt: (ctId: string, modelId?: string) => void;
  /** Shows a time point in the viewer: base dataset plus overlays (others leave the overlay stack). */
  showTimePoint: (baseId: string, overlayIds: string[]) => void;
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
  /** Counts (camera profile needed) or a quantitative image in Bq/ml. */
  unit: "Counts" | "Bq/ml";
  /** MBq per unit of the image value summed over voxels (Counts: calibration; Bq/ml: voxel volume). */
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
  const tpsRaw = setup.timePoints.filter((tp) => byId(tp.spectId));

  // ── Nuclide and energy ──
  const firstSpect = byId(tpsRaw[0]?.spectId);
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

  // ── Acquisition sessions (automatic grouping from FrameOfReference, study and acquisition time) ──
  const isOrganMap = (e: DosEntry) => /^CT-Organe/.test(e.dataset.displayName) || /^CT-Organe/.test(e.dataset.atlas?.name ?? "");
  const isLesionMap = (e: DosEntry) => /Läsion/i.test(e.dataset.displayName) || /Läsion/i.test(e.dataset.atlas?.name ?? "");
  const groupKey = entries.map((e) => `${e.id}:${e.dataset.current.geometry.frameOfReferenceUid ?? ""}:${e.dataset.displayName}`).join("|");
  const grouping = useMemo(() => {
    const item = (e: DosEntry, role: SessionItem["role"]): SessionItem => ({
      id: e.id,
      role,
      acqMs: acquisitionMs(e.dataset),
      frameOfReference: e.dataset.current.geometry.frameOfReferenceUid,
      studyUid: studyUidOf(e.dataset),
    });
    const items: SessionItem[] = [
      ...spectCandidates.map((e) => item(e, "functional")),
      ...cts.map((e) => item(e, "ct")),
      ...labelCandidates.map((e): SessionItem => {
        const parent = cts.find((c) => e.dataset.displayName === `CT-Organe · ${c.dataset.displayName}`)?.id ?? e.dataset.derivedFrom?.sourceId;
        return { ...item(e, "label"), parentId: parent, kind: isOrganMap(e) ? "organs" : isLesionMap(e) ? "lesions" : "other" };
      }),
    ];
    return groupSessions(items);
  }, [groupKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const sessionOf = (id: string | undefined) => grouping.sessions.find((g) => id && [...g.functional, ...g.cts, ...g.organs, ...g.lesions, ...g.otherLabels].includes(id));
  /** Time points proposed from the sessions (one per session with a functional image). */
  const suggested = grouping.sessions
    .filter((g) => g.functional.length)
    .map((g) => ({ spectId: g.functional[0], ctId: g.cts[0], organSetId: g.organs[0], lesionSetId: g.lesions[0] }));
  const sig = (l: { spectId: string; ctId?: string; organSetId?: string; lesionSetId?: string }[]) => l.map((t) => [t.spectId, t.ctId ?? "", t.organSetId ?? "", t.lesionSetId ?? ""].join(",")).sort().join("|");
  // Organ map shown for a time point: explicit choice, else the organ map of its CT.
  const organIdOf = (tp: { ctId?: string; organSetId?: string }) => (tp.organSetId && byId(tp.organSetId) ? tp.organSetId : tp.ctId ? organSetOf(tp.ctId)?.id : undefined);
  const suggestionDiffers = suggested.length > 0 && sig(suggested) !== sig(tpsRaw.map((t) => ({ ...t, organSetId: organIdOf(t) })));
  // Time points in chronological order (the first is the reference of the registration and the voxel map).
  const tpTime = (tp: (typeof tpsRaw)[number]) => tp.tHoursManual ?? hoursPi(acquisitionMs(byId(tp.spectId)!.dataset), setup.injection.timeMs ?? headerInfo?.injectionMs) ?? acquisitionMs(byId(tp.spectId)!.dataset) ?? Infinity;
  const tps = [...tpsRaw].sort((a, b) => tpTime(a) - tpTime(b));

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
    const quant = isQuantitative(h?.units, e.dataset.valueUnit);
    const unit: TpView["unit"] = quant ? "Bq/ml" : "Counts";
    if (h?.units && !quant && h.units.toUpperCase() !== "CNTS") note.push(`Einheit im Header: ${h.units} – wie Counts behandelt`);
    let mbqPerCount: number;
    if (quant) {
      const [sx, sy, sz] = e.dataset.current.geometry.spacing;
      // Bq/ml × ml per voxel → Bq; images decay corrected to the injection are brought back to the acquisition time.
      const toAcq = h?.decayCorrection?.toUpperCase() === "ADMIN" && tH !== undefined && nuclide ? Math.exp((-Math.LN2 * tH * 3600) / nuclide.halfLifeSec) : 1;
      if (h?.decayCorrection?.toUpperCase() === "ADMIN") note.push(tH !== undefined ? "auf Injektion zerfallskorrigiert – auf Aufnahmezeit zurückgerechnet" : "auf Injektion zerfallskorrigiert – Zeit p.i. fehlt");
      mbqPerCount = ((sx * sy * sz) / 1000) * 1e-6 * toAcq;
    } else {
      if (decayCorrected && h?.decayCorrection?.toUpperCase() === "ADMIN") note.push("Bild auf Injektion zerfallskorrigiert – Zeitachse prüfen");
      mbqPerCount = profile && nuclide && durationSec ? countsToMBq(durationSec, profile.cpsPerMBq, nuclide.halfLifeSec, decayCorrected) : NaN;
    }
    const sum = positiveSum(e.dataset.current.data);
    const fovMBq = Number.isFinite(mbqPerCount) ? sum * mbqPerCount : undefined;
    const pctInjected = fovMBq !== undefined && injectedMBq && tH !== undefined && nuclide ? (100 * fovMBq) / (injectedMBq * Math.exp((-Math.LN2 * tH) / halfLifeH)) : undefined;
    return { spectId: tp.spectId, label: e.label, ctId: tp.ctId, tH, durationSec, decayCorrected, unit, mbqPerCount, fovMBq, pctInjected, headerNote: note };
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
  type TpPatch = Partial<DosimetrySetup["timePoints"][number]>;

  /** Label sets of a time point follow its organ/lesion choice (measured for this time point only). */
  function withTpLabels(s: DosimetrySetup, tp: DosimetrySetup["timePoints"][number], prev?: DosimetrySetup["timePoints"][number]): DosimetrySetup {
    let labelSets = s.labelSets;
    for (const [oldId, newId] of [
      [prev?.organSetId, tp.organSetId],
      [prev?.lesionSetId, tp.lesionSetId],
    ] as const) {
      if (oldId && oldId !== newId) labelSets = labelSets.filter((l) => !(l.id === oldId && l.tp === (prev?.spectId ?? tp.spectId)));
      if (newId) labelSets = [...labelSets.filter((l) => l.id !== newId), { id: newId, tp: tp.spectId }];
    }
    const dismissed = (s.labelSetsDismissed ?? []).filter((x) => x !== tp.organSetId && x !== tp.lesionSetId);
    return { ...s, labelSets, labelSetsDismissed: dismissed };
  }

  function addTimePoints(list: TpPatch[]) {
    set((s) => {
      let next: DosimetrySetup = { ...s, timePointsAuto: true };
      for (const tp of list) {
        if (!tp.spectId || next.timePoints.some((t) => t.spectId === tp.spectId)) continue;
        const e = byId(tp.spectId);
        const fo = e?.dataset.current.geometry.frameOfReferenceUid;
        const full = { ...tp, spectId: tp.spectId, ctId: tp.ctId ?? cts.find((c) => fo && c.dataset.current.geometry.frameOfReferenceUid === fo)?.id };
        next = withTpLabels({ ...next, timePoints: [...next.timePoints, full] }, full);
      }
      return next;
    });
  }

  function removeTimePoint(id: string) {
    set((s) => ({ ...s, timePoints: s.timePoints.filter((t) => t.spectId !== id), labelSets: s.labelSets.filter((l) => l.tp !== id) }));
  }

  /** Replaces the time points by the automatic grouping, keeping manual times and durations. */
  function applySuggestion() {
    set((s) => {
      let next: DosimetrySetup = { ...s, timePointsAuto: true, timePoints: [], labelSets: s.labelSets.filter((l) => l.tp === "all") };
      for (const g of suggested) {
        const old = s.timePoints.find((t) => t.spectId === g.spectId);
        const tp = { ...old, ...g, registered: old?.registered && old.ctId === g.ctId };
        next = withTpLabels({ ...next, timePoints: [...next.timePoints, tp] }, tp);
      }
      return next;
    });
  }

  function updateTp(id: string, patch: TpPatch) {
    set((s) => {
      const prev = s.timePoints.find((t) => t.spectId === id);
      if (!prev) return s;
      const tp = { ...prev, ...patch };
      // Another image or CT: the registration of this time point (or of all, for the reference) is void.
      const moved = (patch.spectId !== undefined && patch.spectId !== prev.spectId) || (patch.ctId !== undefined && patch.ctId !== prev.ctId);
      if (moved) tp.registered = false;
      const isRef = tps[0]?.spectId === id;
      let next: DosimetrySetup = {
        ...s,
        timePoints: s.timePoints.map((t) => (t.spectId === id ? tp : moved && isRef ? { ...t, registered: false } : t)),
        labelSets: patch.spectId && patch.spectId !== id ? s.labelSets.map((l) => (l.tp === id ? { ...l, tp: patch.spectId! } : l)) : s.labelSets,
        measurements: patch.spectId && patch.spectId !== id ? Object.fromEntries(Object.entries(s.measurements).filter(([k]) => k !== id)) : s.measurements,
      };
      if ("organSetId" in patch || "lesionSetId" in patch) next = withTpLabels(next, tp, prev);
      return next;
    });
  }

  // First visit: time points from the automatic grouping (later only on request).
  useEffect(() => {
    if (setup.timePointsAuto || setup.timePoints.length || !suggested.length) return;
    applySuggestion();
  }, [grouping]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Time point a label dataset belongs to: same FrameOfReference as its CT/SPECT, or the organ map of its CT. */
  function tpOfLabelSet(id: string, timePoints: DosimetrySetup["timePoints"]): string | undefined {
    const e = byId(id);
    if (!e) return undefined;
    const fo = e.dataset.current.geometry.frameOfReferenceUid;
    return timePoints.find((t) => {
      const ct = byId(t.ctId), sp = byId(t.spectId);
      if (ct && e.dataset.displayName === `CT-Organe · ${ct.dataset.displayName}`) return true;
      return !!fo && (ct?.dataset.current.geometry.frameOfReferenceUid === fo || sp?.dataset.current.geometry.frameOfReferenceUid === fo);
    })?.spectId;
  }

  /** Existing organ map (CT segmentation) of a CT. */
  function organSetOf(ctId: string): DosEntry | undefined {
    const ct = byId(ctId);
    if (!ct) return undefined;
    const fo = ct.dataset.current.geometry.frameOfReferenceUid;
    return (
      labelCandidates.find((e) => e.dataset.displayName === `CT-Organe · ${ct.dataset.displayName}`) ??
      labelCandidates.find((e) => /^CT-Organe/.test(e.dataset.displayName) && !!fo && e.dataset.current.geometry.frameOfReferenceUid === fo)
    );
  }

  function toggleLabelSet(id: string, on: boolean) {
    set((s) => {
      const dismissed = (s.labelSetsDismissed ?? []).filter((x) => x !== id);
      if (!on) return { ...s, labelSets: s.labelSets.filter((l) => l.id !== id), labelSetsDismissed: [...dismissed, id] };
      const tp = tpOfLabelSet(id, s.timePoints);
      return { ...s, labelSetsDismissed: dismissed, labelSets: [...s.labelSets, { id, tp: s.timePoints.length > 1 && tp ? tp : "all" }] };
    });
  }

  // Existing label datasets of the time points (organ maps, lesions, own segmentations on the same CT/SPECT) are
  // used automatically, unless switched off; no new segmentation needed.
  const labelKey = labelCandidates.map((e) => e.id).join() + "|" + setup.timePoints.map((t) => `${t.spectId}:${t.ctId ?? ""}`).join();
  useEffect(() => {
    if (!setup.timePoints.length) return;
    const add = labelCandidates
      .filter((e) => !setup.labelSets.some((l) => l.id === e.id) && !(setup.labelSetsDismissed ?? []).includes(e.id))
      .map((e) => ({ id: e.id, tp: tpOfLabelSet(e.id, setup.timePoints) }))
      .filter((x): x is { id: string; tp: string } => !!x.tp);
    if (!add.length) return;
    set((s) => ({
      ...s,
      labelSets: [...s.labelSets, ...add.filter((a) => !s.labelSets.some((l) => l.id === a.id)).map((a) => ({ id: a.id, tp: s.timePoints.length > 1 ? a.tp : "all" }))],
    }));
  }, [labelKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const done = new Set(pairs.map((p) => p.followers[0]));
      set((s) => ({ ...s, timePoints: s.timePoints.map((t) => (done.has(t.spectId) ? { ...t, registered: true } : t)) }));
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

  const allCalibrated = tpViews.length > 0 && tpViews.every((t) => Number.isFinite(t.mbqPerCount));
  const opt = (e: DosEntry) => ({ id: e.id, label: shortName(e.dataset.displayName), acqMs: acquisitionMs(e.dataset) });
  const usedTpIds = new Set(tps.map((t) => t.spectId));
  const cardViews: TpCardView[] = tpViews.map((v) => {
    const tp = tps.find((t) => t.spectId === v.spectId)!;
    const e = byId(v.spectId)!;
    const acqMs = acquisitionMs(e.dataset);
    const ctAcq = tp.ctId ? acquisitionMs(byId(tp.ctId)!.dataset) : undefined;
    const warnings: string[] = [];
    if (acqMs !== undefined && ctAcq !== undefined && Math.abs(acqMs - ctAcq) > 3 * HOUR)
      warnings.push(`CT ${(Math.abs(acqMs - ctAcq) / HOUR).toFixed(1).replace(".", ",")} h von der Aufnahme entfernt (${fmtDateTime(ctAcq)}) – richtiges CT?`);
    if ((sessionOf(v.spectId)?.functional.length ?? 0) > 1) warnings.push("Zur selben Aufnahme gehören mehrere Funktionsbilder – richtiges Bild gewählt?");
    if (acqMs === undefined && tp.tHoursManual === undefined) warnings.push("Kein Aufnahmedatum im Header – Zeit p.i. bitte eingeben.");
    if (!tp.ctId) warnings.push("Kein CT: Masse aus der Dichte, Organsegmentierung und Registrierung nicht möglich.");
    return {
      spectId: v.spectId,
      label: v.label,
      ctId: tp.ctId,
      organSetId: organIdOf(tp),
      lesionSetId: tp.lesionSetId,
      acqMs,
      tH: v.tH,
      tHoursManual: tp.tHoursManual,
      durationSecManual: tp.durationSecManual,
      durationSec: v.durationSec,
      decayCorrected: v.decayCorrected,
      unit: v.unit,
      calibrated: Number.isFinite(v.mbqPerCount),
      registered: !!tp.registered,
      fovMBq: v.fovMBq,
      pctInjected: v.pctInjected,
      notes: v.headerNote,
      warnings,
    };
  });
  const spare = grouping.sessions
    .filter((g) => g.functional.length && !g.functional.some((id) => usedTpIds.has(id)))
    .map((g) => ({ key: g.key, label: byId(g.functional[0])?.label ?? "", acqMs: g.acqMs, h: hoursPi(g.acqMs, injectionMs) }));
  const used = new Set(tps.flatMap((t) => [t.spectId, t.ctId, organIdOf(t), t.lesionSetId]).filter(Boolean));
  const unassigned: UnassignedItem[] = grouping.unassigned
    .filter((u) => !used.has(u.id) && !setup.labelSets.some((l) => l.id === u.id))
    .map((u) => ({ id: u.id, label: byId(u.id)?.label ?? u.id, role: u.role }));

  return (
    <>
      <InfoText details="Forschungswerkzeug, kein zertifiziertes Medizinprodukt. Grundlage: quantitative SPECT vom Gerät (OSEM mit Schwächungs-, Streu- und Auflösungskorrektur) in Counts; die SPECT-Rekonstruktion dieser App ist dafür nicht geeignet.">
        Forschungswerkzeug · SPECT vom Gerät
      </InfoText>

      <TimePointsCard
        views={cardViews}
        spare={spare}
        unassigned={unassigned}
        options={{
          functional: spectCandidates.map(opt),
          cts: cts.map(opt),
          organs: labelCandidates.filter(isOrganMap).map(opt),
          lesions: labelCandidates.filter((e) => !isOrganMap(e)).map(opt),
        }}
        injection={{ ms: injectionMs, mbq: injectedMBq, fromHeader: setup.injection.timeMs === undefined && headerInfo?.injectionMs !== undefined }}
        onInjection={(patch) =>
          set((s) => ({
            ...s,
            injection: {
              timeMs: patch.timeMs === undefined ? s.injection.timeMs : (patch.timeMs ?? undefined),
              activityMBq: patch.activityMBq === undefined ? s.injection.activityMBq : (patch.activityMBq ?? undefined),
            },
          }))
        }
        suggestionDiffers={suggestionDiffers}
        onApplySuggestion={applySuggestion}
        onUpdate={updateTp}
        onAddSession={(key) => {
          const g = grouping.sessions.find((x) => x.key === key);
          if (g?.functional[0]) addTimePoints([{ spectId: g.functional[0], ctId: g.cts[0], organSetId: g.organs[0], lesionSetId: g.lesions[0] }]);
        }}
        onAddFunctional={(id) => addTimePoints([{ spectId: id }])}
        onAssign={(itemId, role, spectId) => {
          if (role === "functional") updateTp(spectId, { spectId: itemId });
          else if (role === "ct") updateTp(spectId, { ctId: itemId });
          else {
            const e = byId(itemId);
            updateTp(spectId, e && isOrganMap(e) ? { organSetId: itemId } : { lesionSetId: itemId });
          }
        }}
        onRemove={removeTimePoint}
        onShow={(id) => {
          const tp = tps.find((t) => t.spectId === id);
          if (!tp) return;
          const organ = organIdOf(tp);
          api.showTimePoint(tp.ctId ?? tp.spectId, [tp.ctId ? tp.spectId : undefined, organ, tp.lesionSetId].filter((x): x is string => !!x));
        }}
        onSegment={(ctId, modelId) => {
          if (organSetOf(ctId) && !window.confirm("Die Organe dieses CTs sind schon segmentiert. Trotzdem neu segmentieren?")) return;
          api.segmentCt(ctId, modelId);
        }}
        segRunning={api.segRunning}
        onRegister={() => void register()}
        busy={!!busy}
      />

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
        {!energyChecked && (
          <InfoText warn details={`Vorgabewert ${DEFAULT_ENERGIES[nuclideId]?.electronKeV} keV ist ungeprüft – bitte gegen ICRP 107 (oder NNDC NuDat) prüfen und eintragen.`}>
            Energie ungeprüft
          </InfoText>
        )}
        {DEFAULT_ENERGIES[nuclideId] && (
          <InfoText
            details={`Elektronen ${DEFAULT_ENERGIES[nuclideId].electronKeV} keV/Zerfall${DEFAULT_ENERGIES[nuclideId].betaKeV !== undefined ? ` (davon β⁻ ${DEFAULT_ENERGIES[nuclideId].betaKeV} keV)` : ""}${DEFAULT_ENERGIES[nuclideId].photonKeV !== undefined ? `, Photonen ${DEFAULT_ENERGIES[nuclideId].photonKeV} keV/Zerfall (nur mit Kernel berücksichtigt)` : ""}. Quelle: ${DEFAULT_ENERGIES[nuclideId].source}.`}
          >
            {setup.energyOverride[nuclideId] !== undefined ? `Eigener Wert · Vorgabe ${DEFAULT_ENERGIES[nuclideId].electronKeV} keV` : "ICRP 107"}
          </InfoText>
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
        {profileNote(profile)}
        <PhantomCalibration
          candidates={spectCandidates.filter((e) => !usedTpIds.has(e.id))}
          halfLifeSec={nuclide?.halfLifeSec}
          nuclide={nuclideId}
          onUse={(cps, note) => {
            if (profile && window.confirm(`Kalibrierfaktor im Profil „${profile.name}“ durch ${cps} cps/MBq ersetzen?\n(Abbrechen = neues Profil anlegen)`)) {
              saveProfile({ ...profile, cpsPerMBq: cps, nuclide: nuclideId, note });
            } else {
              saveProfile({ id: `cam${Date.now()}`, name: `Phantom ${new Date().toLocaleDateString("de-DE")}`, nuclide: nuclideId, cpsPerMBq: cps, note });
            }
          }}
        />
      </Card>

      <Card title={<>Regionen</>} persistKey="dos-reg" status={labelNames.size ? { text: `${[...labelNames.keys()].filter((k) => regionOpts(k).enabled).length} aktiv`, tone: "info" } : null}
        info="Labelbilder (CT-Organsegmentierung, Läsionen, eigene Segmentierungen). Ein Labelbild gilt für seinen Zeitpunkt oder – nach der Registrierung – für alle Zeitpunkte. Regionen gleichen Namens werden über die Zeitpunkte verbunden. Speichel- und Tränendrüsen sind nicht im CT-Modell: als eigene Segmentierung oder VOI laden.">
        {labelCandidates.length === 0 && (
          <InfoText details="Organe auf dem CT segmentieren (Karte Zeitpunkte) oder Läsionen im Bereich „Segmentierung & MTV“ erzeugen; eigene Segmentierungen als NIfTI laden.">Noch keine Labelbilder</InfoText>
        )}
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
        <button className="primary-btn" disabled={!!busy || !tpViews.length || !setup.labelSets.length || !allCalibrated} onClick={() => void measure()}>
          Aktivitäten messen
        </button>
        {!allCalibrated && <p className="tool-hint">Kalibrierung unvollständig: Kamera-Profil (Nuklid und Kalibrierung) bzw. Aufnahmedauer fehlt.</p>}
      </Card>

      <Card title={<>Kurven und Dosis</>} persistKey="dos-res" status={rows.length ? { text: `${rows.length} Regionen`, tone: "ok" } : null}
        info="Je Region: Aktivität (MBq, ggf. durch den Recovery-Koeffizienten geteilt) über der Zeit, Fit und zeitintegrierte Aktivität (TIA). Automatisch: 1 Zeitpunkt → Hänscheid (bzw. Madsen mit T_eff), 2 → monoexponentiell, ≥ 3 → biexponentiell mit Aufnahmephase, wenn die Aktivität zwischen den ersten Zeitpunkten noch steigt, sonst monoexponentiell. Die Auswaschung ist nie langsamer als der physikalische Zerfall. Dosis = TIA × Elektronenenergie / Masse (lokale Energiedeposition; Masse aus CT-Dichte). Nieren: BED für monoexponentielle Auswaschung.">
        {rows.length === 0 ? (
          <InfoText details="Zeitpunkte, Kalibrierung und Regionen festlegen, dann „Aktivitäten messen“.">Noch keine Messwerte</InfoText>
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
            <span title="Ohne Kernel: lokale Energiedeposition (Lu-177, Tb-161; für I-131 und Y-90 fehlen dann Photonen bzw. die β-Reichweite). Kernel-Tabelle: Zeilen „i j k S“, z. B. Voxel-S-Werte nach Lanconelli 2012 für die passende Voxelgröße.">
              Ohne Kernel: lokale Deposition
            </span>
          )}
        </p>
        <button className="primary-btn" disabled={!!busy || !tpViews.length || !allCalibrated || energy === undefined} onClick={() => void doseMap()}>
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

function profileNote(p: CameraProfile | undefined) {
  return p?.note ? <p className="tool-hint">Kalibrierung: {p.note}</p> : null;
}

/** Quantitative activity-concentration image (DICOM Units BQML, or a value unit Bq/ml set in the app). */
function isQuantitative(units: string | undefined, valueUnit: string | undefined): boolean {
  return units?.trim().toUpperCase() === "BQML" || /^k?bq\/ml$/i.test(valueUnit ?? "");
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
