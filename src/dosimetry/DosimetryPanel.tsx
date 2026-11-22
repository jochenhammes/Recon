import { useEffect, useMemo, useRef, useState } from "react";
import { formatValue } from "../components/format";
import { getExportPatientId, umlaut, withPatientId } from "../core/exportName";
import { csvText, csvWithInfo } from "../core/csv";
import type { Mat4 } from "../core/transform";
import type { LoadedDataset } from "../dataset/types";
import { currentNuclide } from "../header/radionuclide";
import { shortName } from "../dataset/describe";
import { Chart, type ChartSeries } from "../kinetics/Chart";
import { BigTable } from "../ui/BigTable";
import { Card } from "../ui/Card";
import { InfoText } from "../ui/Info";
import { type CameraProfile, QUANT_PROFILE, countsToMBq, isBuiltinProfile, loadProfiles, parseProfiles, recoveryFor, saveProfiles, timePointFromHeader } from "./calibration";
import { type Placed, measureRegions } from "./dose";
import { DEFAULT_ENERGIES, THERAPY_NUCLIDES, localDepositionDose, nuclideById } from "./nuclideData";
import { DEFAULT_ORGANS, type DosRegionOptions, type DosimetrySetup, bedMono, regionKey } from "./setup";
import { PhantomCalibration } from "./PhantomCalibration";
import { TAC_MODEL_LABELS, type TacFit, type TacModel, akaikeWeights, fitTac } from "./tacFit";
import { type DvhStats, dvh, parseKernel, regionDoses } from "./voxelDose";
import { plain, runVoxelDose, type VoxelDoseRun } from "./runner";
import { type DoseUncertainty, doseUncertainty } from "./uncertainty";
import { buildReport } from "./report";
import { ReportOverlay } from "./ReportOverlay";
import { type Centroid, type LesionMatch, labelCentroids, matchLesions } from "./lesionMatch";
import { type SessionItem, acquisitionMs, fmtDateTime, groupSessions, hoursPi, studyUidOf } from "./sessions";
import { type TpCardView, type UnassignedItem, TimePointsCard } from "./TimePointsCard";

import { tr, tBoth } from "../i18n";
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
  /** Segments several CTs one after another; resolves false when one failed or was cancelled. */
  segmentCts: (ctIds: string[], modelId: string | undefined, status: (s: string) => void) => Promise<boolean>;
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
/** " ± sd" with two significant digits; omitted when below 0.05 % of the value (exact fits, synthetic data). */
const pm = (sd: number | undefined, v: number) => (sd === undefined || !Number.isFinite(sd) || !(sd >= 5e-4 * Math.abs(v)) ? "" : ` ± ${formatValue(Number(sd.toPrecision(2)))}`);
/** Percent with one decimal ("< 0,1 %" for tiny values). */
const pct = (rel: number) => (rel * 100 < 0.1 ? "< 0,1 %" : `${(rel * 100).toFixed(1).replace(".", ",")} %`);
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
  /** Where the unit comes from. */
  unitSource: "Header" | "Profil" | "manuell";
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
  /** Combined uncertainty (fit, calibration, RC, volume). */
  unc?: DoseUncertainty;
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
  const voxelRun = useRef<VoxelDoseRun | null>(null);
  /** Report shown in the app (HTML, generated on opening). */
  const [reportView, setReportView] = useState<string | null>(null);
  const [methodCmp, setMethodCmp] = useState<Map<string, { led: number; kernel: number }> | null>(null);
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
  // Default: the built-in quantitative profile (Bq/ml images need no calibration factor).
  const profile = setup.profile ?? QUANT_PROFILE;

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
        const parent = cts.find((c) => tBoth("CT-Organe · {displayName}", { displayName: c.dataset.displayName }).includes(e.dataset.displayName))?.id ?? e.dataset.derivedFrom?.sourceId;
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
  // Only roles the grouping can propose count (maps assigned by hand without a session do not make it differ).
  const suggestionDiffers =
    suggested.length > 0 &&
    sig(suggested.map((g) => {
      const cur = tpsRaw.find((t) => t.spectId === g.spectId);
      return { ...g, organSetId: g.organSetId ?? (cur ? organIdOf(cur) : undefined), lesionSetId: g.lesionSetId ?? cur?.lesionSetId };
    })) !== sig(tpsRaw.map((t) => ({ ...t, organSetId: organIdOf(t) })));
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
    // Unit: chosen by hand, else from the header (BQML / CNTS), else from the camera profile (quantitative or not).
    const headerUnit = h?.units?.trim().toUpperCase();
    const headerQuant = isQuantitative(h?.units, e.dataset.valueUnit);
    const quant = tp.unitOverride ? tp.unitOverride === "Bq/ml" : headerQuant ? true : headerUnit === "CNTS" ? false : !!profile.quantitative;
    const unit: TpView["unit"] = quant ? "Bq/ml" : "Counts";
    const unitSource: TpView["unitSource"] = tp.unitOverride ? "manuell" : headerQuant || headerUnit === "CNTS" ? "Header" : "Profil";
    if (tp.unitOverride && headerUnit && (headerQuant ? "Bq/ml" : "Counts") !== tp.unitOverride) note.push(tr("Header: {v} – von Hand auf {unitOverride} gestellt", { v: headerQuant ? "Bq/ml" : headerUnit === "CNTS" ? "Counts" : headerUnit, unitOverride: tp.unitOverride }));
    else if (headerUnit && !headerQuant && headerUnit !== "CNTS") note.push(tr("Einheit im Header: {v} – wie {unit} behandelt", { v: h!.units, unit }));
    let mbqPerCount: number;
    if (quant) {
      const [sx, sy, sz] = e.dataset.current.geometry.spacing;
      // Bq/ml × ml per voxel → Bq; images decay corrected to the injection are brought back to the acquisition time.
      const toAcq = h?.decayCorrection?.toUpperCase() === "ADMIN" && tH !== undefined && nuclide ? Math.exp((-Math.LN2 * tH * 3600) / nuclide.halfLifeSec) : 1;
      if (h?.decayCorrection?.toUpperCase() === "ADMIN") note.push(tH !== undefined ? tr("auf Injektion zerfallskorrigiert – auf Aufnahmezeit zurückgerechnet") : tr("auf Injektion zerfallskorrigiert – Zeit p.i. fehlt"));
      mbqPerCount = ((sx * sy * sz) / 1000) * 1e-6 * toAcq;
    } else {
      if (decayCorrected && h?.decayCorrection?.toUpperCase() === "ADMIN") note.push(tr("Bild auf Injektion zerfallskorrigiert – Zeitachse prüfen"));
      mbqPerCount = !profile.quantitative && profile.cpsPerMBq > 0 && nuclide && durationSec ? countsToMBq(durationSec, profile.cpsPerMBq, nuclide.halfLifeSec, decayCorrected) : NaN;
    }
    const sum = positiveSum(e.dataset.current.data);
    const fovMBq = Number.isFinite(mbqPerCount) ? sum * mbqPerCount : undefined;
    const pctInjected = fovMBq !== undefined && injectedMBq && tH !== undefined && nuclide ? (100 * fovMBq) / (injectedMBq * Math.exp((-Math.LN2 * tH) / halfLifeH)) : undefined;
    return { spectId: tp.spectId, label: e.label, ctId: tp.ctId, tH, durationSec, decayCorrected, unit, unitSource, mbqPerCount, fovMBq, pctInjected, headerNote: note };
  });

  // ── Regions ──
  const labelNames = useMemo(() => {
    const names = new Map<string, string>();
    // Lesion maps of later time points are measured under the names of the linked lesions of T1.
    const linked = new Set(tps[0]?.lesionSetId ? tps.slice(1).map((t) => t.lesionSetId).filter((id) => id && id !== tps[0].lesionSetId) : []);
    for (const ls of setup.labelSets) {
      if (linked.has(ls.id)) continue;
      const e = entries.find((x) => x.id === ls.id);
      for (const n of e?.dataset.atlas?.labels.values() ?? []) names.set(regionKey(n), n);
    }
    return names;
  }, [setup.labelSets, entries, tps.map((t) => t.lesionSetId).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const regionOpts = (key: string): DosRegionOptions =>
    setup.regions[key] ?? { enabled: DEFAULT_ORGANS.includes(key) || /^(läsion|lesion)/.test(key), model: "auto", recovery: /^(läsion|lesion)/.test(key) };
  /** BED parameters of a region: own values, else the kidney defaults for kidneys. */
  const bedParams = (name: string, o: DosRegionOptions) => {
    const kidney = /kidney|niere/i.test(name);
    return { alphaBeta: o.alphaBeta ?? (kidney ? setup.bed.alphaBeta : undefined), repairH: o.repairH ?? (kidney ? setup.bed.repairHalfTimeH : undefined), kidney };
  };
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
      const unc = doseUncertainty({ doseGy, tia: fit.tia, tiaSd: fit.tiaSd, rcApplied: opts.recovery && rc !== 1, inputs: setup.uncertainty });
      const doseSdGy = unc?.sdGy;
      // BED for every region with α/β and repair half-time (kidneys: the defaults below the table).
      const { alphaBeta, repairH } = bedParams(name, opts);
      const bed = alphaBeta && repairH && fit.teffH && Number.isFinite(doseGy) ? bedMono(doseGy, fit.teffH, alphaBeta, repairH) : undefined;
      out.push({ key, name, opts, t, a, massG, volumeMl, rc, fit, doseGy, doseSdGy, unc, bed });
    }
    return out;
  }, [labelNames, setup, tpViews.map((t) => `${t.spectId}:${t.tH}`).join(), energy, nuclide, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Label maps per time point (source: T1 for all, or each time point its own) ──
  const labelSource = setup.labelSource ?? "t1";
  const isLesionSet = (id: string) => tps.some((t) => t.lesionSetId === id) || (!!byId(id) && isLesionMap(byId(id)!));
  const allHaveLesions = tps.length > 1 && tps.every((t) => !!t.lesionSetId && !!byId(t.lesionSetId));
  /** Label sets measured for a time point (first set wins per region). */
  function setsFor(spectId: string): DosimetrySetup["labelSets"] {
    const common = setup.labelSets.filter((l) => l.tp === "all");
    const t1 = tps[0];
    let sets: DosimetrySetup["labelSets"];
    if (labelSource === "t1" && t1) {
      // T1's organ map, lesion map and other label maps, transferred through the registration.
      const ids = [organIdOf(t1), t1.lesionSetId, ...setup.labelSets.filter((l) => l.tp === t1.spectId).map((l) => l.id)].filter((x): x is string => !!x && !!byId(x));
      sets = [...new Set(ids)].map((id) => ({ id, tp: "all" }));
    } else {
      sets = setup.labelSets.filter((l) => l.tp === spectId);
      // Lesions only when every time point has its own lesion map (otherwise single-point curves).
      if (tps.length > 1 && !allHaveLesions) sets = sets.filter((l) => !isLesionSet(l.id));
    }
    const commonUsed = labelSource === "perTp" && tps.length > 1 && !allHaveLesions ? common.filter((l) => !isLesionSet(l.id)) : common;
    return [...sets, ...commonUsed.filter((c) => !sets.some((x) => x.id === c.id))];
  }

  /**
   * A time point counts as registered when its CT was placed relative to the CT of T1 – by „Zeitpunkte registrieren“
   * here or by the registration in „Koregistrierung“ (the functional image follows its CT there as well) – or when
   * both CTs share a frame of reference.
   */
  const isRegistered = (tp: (typeof tps)[number]) => {
    if (tp.registered) return true;
    const ct = byId(tp.ctId), ref = byId(tps[0]?.ctId);
    if (!ct || !ref || ct.id === ref.id) return false;
    const fo = ct.dataset.current.geometry.frameOfReferenceUid;
    if (fo && fo === ref.dataset.current.geometry.frameOfReferenceUid) return true;
    return ct.matrix.some((v, i) => Math.abs(v - ref.matrix[i]) > 1e-6);
  };

  // ── Lesions across time points (centroids in the registered world, optimal pairing) ──
  const maxMm = setup.lesionLinks?.maxMm ?? 20;
  const refLesionEntry = byId(tps[0]?.lesionSetId);
  const lesionKey = [labelSource, refLesionEntry?.id, ...tps.map((t) => `${t.spectId}:${t.lesionSetId}:${byId(t.lesionSetId)?.matrix.join(",")}`), byId(tps[0]?.lesionSetId)?.matrix.join(","), maxMm].join("|");
  const autoLinks = useMemo(() => {
    const out = new Map<string, { matches: LesionMatch[]; other: Map<number, Centroid> }>();
    if (!refLesionEntry?.dataset.atlas || tps.length < 2 || labelSource === "t1") return out;
    const ref = labelCentroids(place(refLesionEntry));
    for (const tp of tps.slice(1)) {
      const le = byId(tp.lesionSetId);
      if (!le || le.id === refLesionEntry.id) continue;
      const other = labelCentroids(place(le));
      out.set(tp.spectId, { matches: matchLesions(ref, other, maxMm), other });
    }
    return out;
  }, [lesionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Per later time point: its lesion label → name of the linked reference lesion (auto, manually corrected). */
  const lesionLinks = useMemo(() => {
    const byTp = new Map<string, Map<number, string>>();
    const rows = new Map<string, Map<number, { otherId: number | null; distMm?: number; manual: boolean }>>();
    const refAtlas = refLesionEntry?.dataset.atlas;
    if (!refAtlas) return { byTp, rows };
    for (const [spectId, { matches, other }] of autoLinks) {
      const manual = setup.lesionLinks?.manual[spectId] ?? {};
      const m = new Map<number, string>(), r = new Map<number, { otherId: number | null; distMm?: number; manual: boolean }>();
      for (const x of matches) {
        const isManual = String(x.refId) in manual;
        const otherId = isManual ? manual[String(x.refId)] : x.otherId;
        let distMm = x.distMm;
        if (isManual && otherId !== null) {
          const a = labelCentroids(place(refLesionEntry!), new Set([x.refId])).get(x.refId), b = other.get(otherId);
          distMm = a && b ? Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1], a.center[2] - b.center[2]) : undefined;
        }
        r.set(x.refId, { otherId, distMm, manual: isManual });
        if (otherId !== null && !m.has(otherId)) m.set(otherId, refAtlas.labels.get(x.refId) ?? tr("Läsion {refId}", { refId: x.refId }));
      }
      byTp.set(spectId, m);
      rows.set(spectId, r);
    }
    return { byTp, rows };
  }, [autoLinks, setup.lesionLinks]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Fingerprint of what a measurement depends on: label maps (content, region names), their time points, lesion links. */
  const labelSig = [
    ...setup.labelSets.map((l) => {
      const e = byId(l.id);
      return `${l.id}@${l.tp}:${e ? labelHash(e.dataset.current.data) : "-"}:${[...(e?.dataset.atlas?.labels.values() ?? [])].join("/")}`;
    }),
    JSON.stringify(setup.lesionLinks ?? {}),
    labelSource,
    tps.map((t) => `${t.spectId}:${t.ctId ?? ""}:${t.organSetId ?? ""}:${t.lesionSetId ?? ""}`).join(","),
  ].join("|");
  const measurementStale = Object.keys(setup.measurements).length > 0 && setup.measuredSig !== undefined && setup.measuredSig !== labelSig;

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
        // Keep organ/lesion maps chosen by hand when the grouping has none (e.g. NIfTI without date).
        const tp = { ...old, ...g, organSetId: g.organSetId ?? old?.organSetId, lesionSetId: g.lesionSetId ?? old?.lesionSetId, registered: old?.registered && old.ctId === g.ctId };
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
      if (ct && tBoth("CT-Organe · {displayName}", { displayName: ct.dataset.displayName }).includes(e.dataset.displayName)) return true;
      return !!fo && (ct?.dataset.current.geometry.frameOfReferenceUid === fo || sp?.dataset.current.geometry.frameOfReferenceUid === fo);
    })?.spectId;
  }

  /** Existing organ map (CT segmentation) of a CT. */
  function organSetOf(ctId: string): DosEntry | undefined {
    const ct = byId(ctId);
    if (!ct) return undefined;
    const fo = ct.dataset.current.geometry.frameOfReferenceUid;
    return (
      labelCandidates.find((e) => tBoth("CT-Organe · {displayName}", { displayName: ct.dataset.displayName }).includes(e.dataset.displayName)) ??
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
    setBusy(tr("Aktivitäten messen"));
    setError(null);
    api.onActivity(tr("Aktivitäten messen"));
    try {
      const enabledKeys = new Set([...labelNames.keys()].filter((k) => regionOpts(k).enabled));
      const measurements: DosimetrySetup["measurements"] = {};
      for (const [n, tp] of tpViews.entries()) {
        setStatus(tr("Zeitpunkt {v}/{length}", { v: n + 1, length: tpViews.length }));
        await new Promise((r) => setTimeout(r, 10));
        if (!Number.isFinite(tp.mbqPerCount)) throw new Error(tr("{label}: Kalibrierung unvollständig (Kamera-Profil, Aufnahmedauer).", { label: tp.label }));
        const spect = byId(tp.spectId)!;
        const ct = byId(tp.ctId);
        const sets = setsFor(tp.spectId);
        const res: Record<string, ReturnType<typeof measureRegions> extends Map<number, infer R> ? R & { name: string } : never> = {};
        for (const ls of sets) {
          const le = byId(ls.id);
          const atlas = le?.dataset.atlas;
          if (!le || !atlas) continue;
          // Lesion map of a later time point: names of the linked reference lesions (unlinked lesions are not measured).
          const link = ls.id === tps.find((t) => t.spectId === tp.spectId)?.lesionSetId ? lesionLinks.byTp.get(tp.spectId) : undefined;
          const nameOf = (id: number) => (link ? link.get(id) : (atlas.labels.get(id) ?? String(id)));
          const only = new Set([...atlas.labels.keys()].filter((id) => {
            const name = nameOf(id);
            return !!name && enabledKeys.has(regionKey(name)) && !res[regionKey(name)];
          }));
          if (!only.size) continue;
          const m = measureRegions(place(le), place(spect), tp.mbqPerCount, ct ? place(ct) : undefined, only);
          for (const [id, r] of m) {
            const name = nameOf(id)!;
            res[regionKey(name)] = { ...r, name };
          }
        }
        measurements[tp.spectId] = res;
      }
      set((s) => ({ ...s, measurements, measuredSig: labelSig }));
      setStatus(tr("Gemessen: {v} Regionen über {length} Zeitpunkt(e).", { v: Object.values(measurements).reduce((s, m) => s + Object.keys(m).length, 0), length: tpViews.length }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(null);
      api.onActivity(null);
    }
  }

  async function segmentMissing(ctIds: string[]) {
    setBusy("Organsegmentierung");
    setError(null);
    try {
      const ok = await api.segmentCts(ctIds, undefined, setStatus);
      setStatus(ok ? tr("{length} CT(s) segmentiert – jetzt „Aktivitäten messen“.", { length: ctIds.length }) : tr("Organsegmentierung abgebrochen oder fehlgeschlagen (Details in der Karte CT-Organsegmentierung)."));
    } finally {
      setBusy(null);
    }
  }

  async function register() {
    const ref = tpViews[0];
    if (!ref?.ctId) return;
    setBusy("Registrierung");
    setError(null);
    api.onActivity(tr("Zeitpunkte registrieren"));
    try {
      const pairs = tpViews.slice(1).filter((tp) => tp.ctId).map((tp) => ({
        ctId: tp.ctId!,
        followers: [tp.spectId, ...setup.labelSets.filter((l) => l.tp === tp.spectId).map((l) => l.id)],
      }));
      await api.registerTimePoints(ref.ctId, pairs, setStatus);
      const done = new Set(pairs.map((p) => p.followers[0]));
      set((s) => ({ ...s, timePoints: s.timePoints.map((t) => (done.has(t.spectId) ? { ...t, registered: true } : t)) }));
      setStatus(tr("{length} Zeitpunkt(e) auf das CT von {label} registriert. Bitte die Überlagerung prüfen.", { length: pairs.length, label: ref.label }));
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
        if (tp.tH === undefined || !Number.isFinite(tp.mbqPerCount)) throw new Error(tr("{label}: Zeitpunkt oder Kalibrierung fehlt.", { label: tp.label }));
        return { spect: place(byId(tp.spectId)!), mbqPerCount: tp.mbqPerCount, tH: tp.tH };
      });
      const refPlaced = place(byId(ref.spectId)!);
      const kernel = setup.voxel.kernel;
      if (kernel && Math.abs(kernel.voxelMm - refPlaced.volume.geometry.spacing[0]) / kernel.voxelMm > 0.05)
        throw new Error(tr("Kernel-Voxelgröße {voxelMm} mm passt nicht zur SPECT-Voxelgröße {v} mm.", { voxelMm: kernel.voxelMm, v: refPlaced.volume.geometry.spacing[0].toFixed(2) }));
      const refCt = byId(ref.ctId);
      const run = runVoxelDose(
        {
          ref: plain(refPlaced),
          timePoints: vtps.map((t) => ({ spect: plain(t.spect), mbqPerCount: t.mbqPerCount, tH: t.tH })),
          ct: refCt ? plain(place(refCt)) : undefined,
          physHalfLifeH: halfLifeH,
          electronKeV: energy,
          method: setup.voxel.method,
          kernel,
        },
        (stage, f) => setStatus(`${stage}${f > 0 ? ` ${Math.round(f * 100)} %` : " …"}`),
      );
      voxelRun.current = run;
      const { dose, led } = await run.promise;
      // Method comparison: mean dose per region, local deposition vs. kernel.
      if (led) {
        const ledPlaced: Placed = { volume: refPlaced.volume.withData(led), matrix: refPlaced.matrix };
        const kerPlaced: Placed = { volume: refPlaced.volume.withData(dose), matrix: refPlaced.matrix };
        const cmp = new Map<string, { led: number; kernel: number }>();
        for (const [key, { le, ids }] of regionLabelIds(ref.spectId)) {
          const mean = (v: Float32Array) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
          cmp.set(key, { led: mean(regionDoses(place(le), ledPlaced, ids)), kernel: mean(regionDoses(place(le), kerPlaced, ids)) });
        }
        setMethodCmp(cmp);
      } else setMethodCmp(null);
      const name = tr("Dosis (Gy) · {nuclideId} · {v}", { nuclideId, v: kernel ? "Kernel" : "lokal" });
      const id = api.putDoseMap(ref.spectId, dose, name, setup.voxel.doseId && byId(setup.voxel.doseId) ? setup.voxel.doseId : undefined);
      set((s) => ({ ...s, voxel: { ...s.voxel, doseId: id } }));
      let max = 0;
      for (const v of dose) if (v > max) max = v;
      setStatus(tr("Dosiskarte erstellt (Maximum {v} Gy).", { v: fmt(max) }));
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setStatus(tr("Dosiskarte abgebrochen."));
      else {
        setError(e instanceof Error ? e.message : String(e));
        setStatus(null);
      }
    } finally {
      setBusy(null);
      api.onActivity(null);
      voxelRun.current = null;
    }
  }

  /** Label ids per enabled region (first label set wins) of the label sets valid for a time point. */
  function regionLabelIds(spectId: string): Map<string, { le: DosEntry; ids: Set<number> }> {
    const out = new Map<string, { le: DosEntry; ids: Set<number> }>();
    for (const ls of setsFor(spectId)) {
      const le = entries.find((e) => e.id === ls.id);
      const atlas = le?.dataset.atlas;
      if (!le || !atlas) continue;
      const local = new Map<string, Set<number>>();
      for (const [id, name] of atlas.labels) {
        const key = regionKey(name);
        if (!regionOpts(key).enabled || out.has(key)) continue;
        local.set(key, new Set([...(local.get(key) ?? []), id]));
      }
      for (const [key, ids] of local) out.set(key, { le, ids });
    }
    return out;
  }

  async function loadKernel(file: File) {
    setError(null);
    try {
      const voxel = Number(kernelVoxel.replace(",", "."));
      if (!(voxel > 0)) throw new Error(tr("Bitte zuerst die Voxelgröße des Kernels (mm) eintragen."));
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
    const refTp = tpViews[0]?.spectId;
    if (!doseEntry || !refTp) return out;
    for (const [key, { le, ids }] of regionLabelIds(refTp)) {
      const st = dvh(regionDoses(place(le), place(doseEntry), ids));
      if (st) out.set(key, st);
    }
    return out;
  }, [doseEntry?.dataset.current, setup.labelSets, setup.regions]); // eslint-disable-line react-hooks/exhaustive-deps

  function downloadCsv() {
    const f = (v: number | undefined, d = 4) => (v === undefined || !Number.isFinite(v) ? "" : v.toFixed(d).replace(".", ","));
    const sep = ";";
    const maxTp = Math.max(0, ...rows.map((r) => r.t.length));
    const head = ["Region", "Volumen_ml", "Masse_g", "RC", ...Array.from({ length: maxTp }, (_, i) => [`t${i + 1}_h`, tr("A{v}_MBq", { v: i + 1 })]).flat(), "Modell", "Teff_h", "TIA_MBq_h", "TIA_SD", "Dosis_Gy", "Dosis_SD_Gy", "Unsicherheit_rel_%", tr("Unsicherheit_Anteile"), "BED_Gy", "Dmean_Voxel_Gy", "D2_Gy", "D50_Gy", "D98_Gy"];
    const lines = rows.map((r) => {
      const d = dvhs.get(r.key);
      const pts = Array.from({ length: maxTp }, (_, i) => [f(r.t[i], 2), f(r.a[i])]).flat();
      return [csvText(r.name), f(r.volumeMl, 2), f(r.massG, 2), f(r.rc, 3), ...pts, csvText(TAC_MODEL_LABELS[r.fit.model]), f(r.fit.teffH, 2), f(r.fit.tia, 2), f(r.fit.tiaSd, 2), f(r.doseGy), f(r.doseSdGy), f(r.unc ? r.unc.rel * 100 : undefined, 1), csvText(r.unc ? r.unc.parts.map((p) => `${p.label} ${(p.rel * 100).toFixed(1)} %`).join(", ") : ""), f(r.bed), f(d?.mean), f(d?.d2), f(d?.d50), f(d?.d98)].join(sep);
    });
    const csv = csvWithInfo([head.join(sep), ...lines], [
      ["Nuklid", nuclideId],
      ["Elektronenenergie keV/Zerfall", String(energy ?? "")],
      [tr("Kamera-Profil"), profile.quantitative ? tr("{name} (Bq/ml, kein Kalibrierfaktor)", { name: profile.name }) : tr("{name} ({cpsPerMBq} cps/MBq)", { name: profile.name, cpsPerMBq: profile.cpsPerMBq })],
      ["Injektion", injectionMs ? new Date(injectionMs).toLocaleString("de-DE") : ""],
      [tr("Injizierte Aktivität MBq"), String(injectedMBq ?? "")],
      ["Methode", tr("Lokale Energiedeposition der Elektronen (Organ/Läsion); Voxelkarte: ") + (setup.voxel.kernel ? tr("Kernel {name}", { name: setup.voxel.kernel.name }) : "lokal")],
      ["Hinweis", "Forschungswerkzeug, kein Medizinprodukt"],
    ]);
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = withPatientId(tr("Dosimetrie_{v}.csv", { v: nuclideId.replace(/[äöüÄÖÜß]/g, umlaut) }));
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Self-contained HTML report with all intermediate results. */
  function reportHtml(): string {
    const views = cardViewsFor();
    return buildReport({
      patientId: getExportPatientId() || undefined,
      created: new Date(),
      nuclide: nuclideId,
      halfLife: nuclide?.halfLifeText ?? "",
      electronKeV: energy,
      energySource: setup.energyOverride[nuclideId] !== undefined ? tr("eigener Wert") : (DEFAULT_ENERGIES[nuclideId]?.source ?? ""),
      calibration: (() => {
        const rcText = profile.recovery?.length ? `; RC ${profile.recovery.map((r) => `${r.volumeMl} ml → ${r.rc}`).join(", ")}` : "";
        if (tpViews.every((t) => t.unit === "Bq/ml")) return tr("quantitative Bilder (Bq/ml), kein Kalibrierfaktor (Profil {name}){rcText}", { name: profile.name, rcText });
        if (profile.quantitative) return tr("Bilder in Counts, aber quantitatives Profil gewählt – Kalibrierung fehlt");
        return `${profile.name}: ${profile.cpsPerMBq} cps/MBq${profile.collimator ? `, Kollimator ${profile.collimator}` : ""}${profile.window ? `, Fenster ${profile.window}` : ""}${rcText}${profile.note ? ` (${profile.note})` : ""}`;
      })(),
      injection: `${injectionMs ? new Date(injectionMs).toLocaleString("de-DE") : tr("Zeit fehlt")} · ${injectedMBq !== undefined ? `${injectedMBq} MBq` : tr("Aktivität fehlt")}`,
      timePoints: views.map((v, n) => ({
        label: `T${n + 1}: ${v.label}`,
        acqText: fmtDateTime(v.acqMs),
        tH: v.tH,
        durationSec: v.durationSec,
        unit: v.unit,
        calibration: Number.isFinite(tpViews[n].mbqPerCount) ? tpViews[n].mbqPerCount.toExponential(4) : "–",
        ct: byId(v.ctId)?.label,
        organs: byId(v.organSetId)?.label,
        lesions: byId(v.lesionSetId)?.label,
        registered: n === 0 ? "Referenz" : v.registered ? "ja" : "nein",
        fovMBq: v.fovMBq,
        pctInjected: v.pctInjected,
      })),
      regions: rows.map((r) => {
        const aw = akaikeWeights(r.t, r.a, { physHalfLifeH: halfLifeH });
        return {
          name: r.name,
          volumeMl: r.volumeMl,
          massG: r.massG,
          rc: r.rc,
          t: r.t,
          a: r.a,
          model: TAC_MODEL_LABELS[r.fit.model],
          teffH: r.fit.teffH,
          tia: r.fit.tia,
          tiaSd: r.fit.tiaSd,
          akaike: aw.weights.length ? `${aw.weights.map((w) => `${TAC_MODEL_LABELS[w.model]} ${Math.round(w.weight * 100)} %`).join(", ")}; gewichtete TIA ${fmt(aw.averagedTia)} MBq·h` : undefined,
          doseGy: r.doseGy,
          doseSdGy: r.doseSdGy,
          uncertainty: r.unc ? `± ${pct(r.unc.rel)} (${r.unc.parts.map((p) => `${p.label} ${pct(p.rel)}`).join(", ")})` : undefined,
          bed: r.bed,
          dvh: dvhs.get(r.key),
          methodCmp: methodCmp?.get(r.key),
          curve: r.fit.curve,
          note: r.fit.note,
        };
      }),
      methods: [
        [tr("Organ-/Läsionsdosis"), "TIA × Elektronenenergie / Masse (lokale Energiedeposition); Masse aus der CT-Dichte (ρ = 1 + HU/1000, oberhalb von Wasser 1 + 0,6·HU/1000)"],
        ["Kurvenmodelle", "automatisch: 1 Zeitpunkt Hänscheid (Madsen mit T_eff), 2 monoexponentiell, ≥ 3 biexponentiell mit Aufnahme wenn ansteigend; Auswaschung nicht langsamer als der physikalische Zerfall"],
        ["Voxelkarte", doseEntry ? `${setup.voxel.method === "mono" ? "monoexponentiell (log-linear)" : tr("Trapez + Ausläufer")} je Voxel; ${setup.voxel.kernel ? `Faltung mit Kernel ${setup.voxel.kernel.name} (${setup.voxel.kernel.voxelMm} mm), Dichte-Skalierung ρ_Wasser/ρ` : "lokale Deposition"}` : "nicht berechnet"],
        [tr("Läsionen über Zeitpunkte"), refLesionEntry ? tr("Schwerpunkt-Zuordnung, max. {maxMm} mm{v}", { maxMm, v: Object.keys(setup.lesionLinks?.manual ?? {}).length ? tr(", manuell korrigiert") : "" }) : "–"],
        ["Unsicherheit", "EANM-Leitfaden (Gear et al., EJNMMI Physics 2018): Fit-Kovarianz und eingegebene relative Unsicherheiten quadratisch addiert, k = 1"],
        ["Quellen", "MIRD-Pamphlete 23/26; EANM-Empfehlungen Lu-177 (2022); ICRP Publication 107; Hänscheid et al.; Madsen et al."],
      ],
      uncertaintyInputs: [
        ["Kalibrierung", setup.uncertainty?.calibrationPct],
        ["Recovery", setup.uncertainty?.rcPct],
        ["Volumen", setup.uncertainty?.volumePct],
      ]
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k} ${v} %`)
        .join(", ") || "keine (nur Fit)",
    });
  }

  function downloadReport() {
    const url = URL.createObjectURL(new Blob([reportHtml()], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = withPatientId(tr("Dosimetrie-Bericht_{nuclideId}.html", { nuclideId }));
    a.click();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    const w = window.open("", "_blank");
    if (!w) return setError(tr("Das Druckfenster wurde vom Browser blockiert – „Bericht (HTML)“ herunterladen und dort drucken."));
    w.document.write(reportHtml());
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  const sel = rows.find((r) => r.key === selected) ?? rows[0];
  const chart: ChartSeries[] = sel
    ? (() => {
        const tMax = Math.max(...sel.t, sel.fit.teffH ?? 0) * 2;
        const xs = Array.from({ length: 80 }, (_, i) => (tMax * i) / 79);
        return [
          { label: tr("Messung"), x: sel.t, y: sel.a, style: "points" as const, color: "#e8590c" },
          { label: TAC_MODEL_LABELS[sel.fit.model], x: xs, y: xs.map(sel.fit.curve), style: "line" as const, color: "#7c6cf0" },
        ];
      })()
    : [];
  const selDvh = sel ? dvhs.get(sel.key) : undefined;

  const allCalibrated = tpViews.length > 0 && tpViews.every((t) => Number.isFinite(t.mbqPerCount));
  const opt = (e: DosEntry) => ({ id: e.id, label: shortName(e.dataset.displayName), acqMs: acquisitionMs(e.dataset) });
  const usedTpIds = new Set(tps.map((t) => t.spectId));
  const cardViews = cardViewsFor();
  function cardViewsFor(): TpCardView[] {
    return tpViews.map((v) => {
    const tp = tps.find((t) => t.spectId === v.spectId)!;
    const e = byId(v.spectId)!;
    const acqMs = acquisitionMs(e.dataset);
    const ctAcq = tp.ctId ? acquisitionMs(byId(tp.ctId)!.dataset) : undefined;
    const warnings: string[] = [];
    if (acqMs !== undefined && ctAcq !== undefined && Math.abs(acqMs - ctAcq) > 3 * HOUR)
      warnings.push(tr("CT {v} h von der Aufnahme entfernt ({v2}) – richtiges CT?", { v: (Math.abs(acqMs - ctAcq) / HOUR).toFixed(1).replace(".", ","), v2: fmtDateTime(ctAcq) }));
    if ((sessionOf(v.spectId)?.functional.length ?? 0) > 1) warnings.push(tr("Zur selben Aufnahme gehören mehrere Funktionsbilder – richtiges Bild gewählt?"));
    if (acqMs === undefined && tp.tHoursManual === undefined) warnings.push(tr("Kein Aufnahmedatum im Header – Zeit p.i. bitte eingeben."));
    if (!tp.ctId) warnings.push(tr("Kein CT: Masse aus der Dichte, Organsegmentierung und Registrierung nicht möglich."));
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
      unitSource: v.unitSource,
      calibrated: Number.isFinite(v.mbqPerCount),
      registered: isRegistered(tp),
      fovMBq: v.fovMBq,
      pctInjected: v.pctInjected,
      notes: v.headerNote,
      warnings,
    };
    });
  }
  const spare = grouping.sessions
    .filter((g) => g.functional.length && !g.functional.some((id) => usedTpIds.has(id)))
    .map((g) => ({ key: g.key, label: byId(g.functional[0])?.label ?? "", acqMs: g.acqMs, h: hoursPi(g.acqMs, injectionMs) }));
  const used = new Set(tps.flatMap((t) => [t.spectId, t.ctId, organIdOf(t), t.lesionSetId]).filter(Boolean));
  const unassigned: UnassignedItem[] = grouping.unassigned
    .filter((u) => !used.has(u.id) && !setup.labelSets.some((l) => l.id === u.id))
    .map((u) => ({ id: u.id, label: byId(u.id)?.label ?? u.id, role: u.role }));

  return (
    <>
      <InfoText details={tr("Forschungswerkzeug, kein zertifiziertes Medizinprodukt. Grundlage: quantitative SPECT vom Gerät (OSEM mit Schwächungs-, Streu- und Auflösungskorrektur) in Counts; die SPECT-Rekonstruktion dieser App ist dafür nicht geeignet.")}>
        {tr("Forschungswerkzeug · SPECT vom Gerät")}
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
          if (organSetOf(ctId) && !window.confirm(tr("Die Organe dieses CTs sind schon segmentiert. Trotzdem neu segmentieren?"))) return;
          api.segmentCt(ctId, modelId);
        }}
        segRunning={api.segRunning}
        onRegister={() => void register()}
        busy={!!busy}
      />

      <Card
        title={<>{tr("Nuklid und Kalibrierung")}</>}
        persistKey="dos-cal"
        status={tpViews.some((t) => t.unit === "Counts") && profile.quantitative ? { text: tr("Faktor fehlt"), tone: "warn" } : { text: profile.quantitative ? "Bq/ml" : profile.name, tone: "ok" }}
        info={tr("Standard ist das Profil „Quantitativ (Bq/ml, z. B. xSPECT Quant)“: Bilder mit echten Aktivitätskonzentrationen brauchen keinen Kalibrierfaktor. Für SPECT in Counts ein Profil mit Kalibrierfaktor der Kamerakonfiguration (Kamera, Kollimator, Energiefenster, Rekonstruktion) in cps/MBq anlegen oder aus einer Phantomaufnahme bestimmen: Counts / (Aufnahmedauer × Faktor) = MBq, Zerfall während der Aufnahme korrigiert. Recovery-Koeffizienten (Kugelphantom) korrigieren den Partialvolumeneffekt kleiner Läsionen – auch bei quantitativen Bildern („Mit RC als eigenes Profil“).")}>
        <div className="field-row">
          <label className="field">
            {tr("Nuklid")}{headerNuclide && headerNuclide !== nuclideId ? tr(" (Header: {headerNuclide})", { headerNuclide }) : ""}
            <select value={nuclideId} onChange={(e) => set((s) => ({ ...s, nuclide: e.target.value }))}>
              {THERAPY_NUCLIDES.map((n) => (
                <option key={n} value={n}>
                  {n} – T½ {nuclideById(n)?.halfLifeText}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {tr("Elektronen (keV/Zerfall)")}
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
          <InfoText warn details={tr("Vorgabewert {v} keV ist ungeprüft – bitte gegen ICRP 107 (oder NNDC NuDat) prüfen und eintragen.", { v: DEFAULT_ENERGIES[nuclideId]?.electronKeV })}>
            {tr("Energie ungeprüft")}
          </InfoText>
        )}
        {DEFAULT_ENERGIES[nuclideId] && (
          <InfoText
            details={`Elektronen ${DEFAULT_ENERGIES[nuclideId].electronKeV} keV/Zerfall${DEFAULT_ENERGIES[nuclideId].betaKeV !== undefined ? ` (davon β⁻ ${DEFAULT_ENERGIES[nuclideId].betaKeV} keV)` : ""}${DEFAULT_ENERGIES[nuclideId].photonKeV !== undefined ? `, Photonen ${DEFAULT_ENERGIES[nuclideId].photonKeV} keV/Zerfall (nur mit Kernel berücksichtigt)` : ""}. Quelle: ${DEFAULT_ENERGIES[nuclideId].source}.`}
          >
            {setup.energyOverride[nuclideId] !== undefined ? tr("Eigener Wert · Vorgabe {v} keV", { v: DEFAULT_ENERGIES[nuclideId].electronKeV }) : "ICRP 107"}
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
            if (!profile.quantitative && window.confirm(tr("Kalibrierfaktor im Profil „{name}“ durch {cps} cps/MBq ersetzen?\n(Abbrechen = neues Profil anlegen)", { name: profile.name, cps }))) {
              saveProfile({ ...profile, cpsPerMBq: cps, nuclide: nuclideId, note });
            } else {
              saveProfile({ id: `cam${Date.now()}`, name: tr("Phantom {v}", { v: new Date().toLocaleDateString("de-DE") }), nuclide: nuclideId, cpsPerMBq: cps, note });
            }
          }}
        />
      </Card>

      <Card title={<>{tr("Regionen")}</>} persistKey="dos-reg" status={labelNames.size ? { text: tr("{v} aktiv", { v: [...labelNames.keys()].filter((k) => regionOpts(k).enabled).length }), tone: "info" } : null}
        info={tr("Labelbilder (CT-Organsegmentierung, Läsionen, eigene Segmentierungen). Ein Labelbild gilt für seinen Zeitpunkt oder – nach der Registrierung – für alle Zeitpunkte. Regionen gleichen Namens werden über die Zeitpunkte verbunden. Speichel- und Tränendrüsen sind nicht im CT-Modell: als eigene Segmentierung oder VOI laden.")}>
        {tps.length > 1 && (
          <div className="dos-labelsource">
            <div className="segmented-control" role="group" aria-label={tr("Labelbilder der Zeitpunkte")}>
              <button className={labelSource === "t1" ? "active" : ""} onClick={() => set((s) => ({ ...s, labelSource: "t1" }))}>
                {tr("Von T1 für alle")}
              </button>
              <button className={labelSource === "perTp" ? "active" : ""} onClick={() => set((s) => ({ ...s, labelSource: "perTp" }))}>
                {tr("Organkarte je Zeitpunkt")}
              </button>
            </div>
            {labelSource === "t1" ? (
              <>
                <p className="tool-hint">
                  Organkarte{tps[0].lesionSetId ? tr(" und Läsionen") : ""} von T1 ({byId(organIdOf(tps[0]))?.label ?? tr("keine Organkarte")}) gelten über die Registrierung für alle Zeitpunkte; eigene Labelbilder der anderen
                  {tr("Zeitpunkte werden nicht verwendet.")}
                </p>
                {tps.slice(1).some((t) => !isRegistered(t)) && (
                  <InfoText warn details={tr("Die Labelbilder von T1 werden über die Registrierung auf die anderen Zeitpunkte übertragen. Ohne Registrierung liegen sie dort an der falschen Stelle. „Zeitpunkte registrieren“ (Karte Zeitpunkte) oder im Bereich Koregistrierung.")}>
                    {tr("Nicht alle Zeitpunkte registriert")}
                  </InfoText>
                )}
              </>
            ) : (
              <>
                {(() => {
                  const missing = tps.filter((t) => t.ctId && !organIdOf(t)).map((t) => t.ctId!);
                  return missing.length ? (
                    <div className="button-row">
                      <button className="secondary-btn" disabled={api.segRunning || !!busy} onClick={() => void segmentMissing(missing)}>
                        {api.segRunning ? tr("Segmentierung läuft …") : tr("Fehlende Organkarten segmentieren ({length} CT{v})", { length: missing.length, v: missing.length > 1 ? "s" : "" })}
                      </button>
                    </div>
                  ) : (
                    <p className="tool-hint">{tr("Jeder Zeitpunkt hat eine eigene Organkarte – gemessen wird in der Anatomie des jeweiligen CTs (keine Registrierung nötig).")}</p>
                  );
                })()}
                {!allHaveLesions && tps.some((t) => t.lesionSetId) && (
                  <InfoText warn details={tr("Für die Läsionen braucht jeder Zeitpunkt ein eigenes Läsionsbild (in „Segmentierung & Läsionen“ je SPECT segmentieren); sonst ergäben sich Kurven mit nur einem Punkt. Alternative: „Von T1 für alle“.")}>
                    {tr("Läsionen werden in diesem Modus nicht ausgewertet")}
                  </InfoText>
                )}
              </>
            )}
          </div>
        )}
        {labelCandidates.length === 0 && (
          <InfoText details={tr("Organe auf dem CT segmentieren (Karte Zeitpunkte) oder Läsionen im Bereich „Segmentierung & Läsionen“ erzeugen; eigene Segmentierungen als NIfTI laden.")}>{tr("Noch keine Labelbilder")}</InfoText>
        )}
        {labelCandidates.map((e) => {
          const ls = setup.labelSets.find((l) => l.id === e.id);
          return (
            <div key={e.id} className="checkbox-field">
              <input type="checkbox" checked={!!ls} onChange={(ev) => toggleLabelSet(e.id, ev.target.checked)} />
              <span className="export-item-name">{e.label}</span>
              {ls && (
                <select value={ls.tp} onChange={(ev) => set((s) => ({ ...s, labelSets: s.labelSets.map((l) => (l.id === e.id ? { ...l, tp: ev.target.value } : l)) }))}>
                  <option value="all">{tr("alle Zeitpunkte")}</option>
                  {tpViews.map((tp, n) => (
                    <option key={tp.spectId} value={tp.spectId}>
                      {tr("Zeitpunkt {v}", { v: n + 1 })}
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
                      <label title={tr("Recovery-Koeffizient anwenden")}>
                        <input type="checkbox" checked={o.recovery} onChange={(e) => setRegion(key, { recovery: e.target.checked })} /> RC
                      </label>
                    </em>
                  )}
                </label>
              );
            })}
          </div>
        )}
        {lesionLinks.rows.size > 0 && refLesionEntry?.dataset.atlas && (
          <div className="dos-lesions">
            <div className="field-row">
              <InfoText details={tr("Läsionsbilder je Zeitpunkt werden über die Schwerpunkte im registrierten Raum einander zugeordnet (optimale Paarung, höchstens {maxMm} mm Abstand). Gemessen wird unter dem Namen der Läsion von T1; Läsionen ohne Partner zählen nicht. Zuordnung per Auswahl korrigierbar. Vorher „Zeitpunkte registrieren“.", { maxMm })}>
                {tr("Läsionen über Zeitpunkte")}
              </InfoText>
              <label className="field">
                {tr("max. Abstand (mm)")}
                <input type="text" inputMode="decimal" value={maxMm} onChange={(e) => set((s) => ({ ...s, lesionLinks: { manual: s.lesionLinks?.manual ?? {}, maxMm: numOrUndef(e.target.value) ?? 20 } }))} />
              </label>
            </div>
            {tps.slice(1).some((t) => !isRegistered(t) && t.lesionSetId) && <p className="tool-hint tool-warning">{tr("Nicht alle Zeitpunkte sind registriert – Abstände sind dann nicht aussagekräftig.")}</p>}
            <table className="region-table">
              <thead>
                <tr>
                  <th>T1</th>
                  {[...lesionLinks.rows.keys()].map((id) => (
                    <th key={id}>T{tps.findIndex((t) => t.spectId === id) + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...refLesionEntry.dataset.atlas.labels].map(([refId, refName]) => (
                  <tr key={refId}>
                    <td>{refName}</td>
                    {[...lesionLinks.rows].map(([spectId, rows]) => {
                      const r = rows.get(refId);
                      const otherAtlas = byId(tps.find((t) => t.spectId === spectId)?.lesionSetId)?.dataset.atlas;
                      return (
                        <td key={spectId}>
                          <select
                            className={`inline-select${r?.manual ? " manual" : ""}`}
                            value={r?.otherId ?? ""}
                            title={r?.manual ? tr("manuell zugeordnet") : "automatisch"}
                            onChange={(e) =>
                              set((s) => {
                                const links = s.lesionLinks ?? { maxMm, manual: {} };
                                return { ...s, lesionLinks: { ...links, manual: { ...links.manual, [spectId]: { ...(links.manual[spectId] ?? {}), [String(refId)]: e.target.value ? Number(e.target.value) : null } } } };
                              })
                            }
                          >
                            <option value="">–</option>
                            {[...(otherAtlas?.labels ?? [])].map(([id, name]) => (
                              <option key={id} value={id}>
                                {name}
                              </option>
                            ))}
                          </select>
                          {r?.distMm !== undefined && <small> {Math.round(r.distMm)} mm</small>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {Object.keys(setup.lesionLinks?.manual ?? {}).length > 0 && (
              <button className="link-btn" onClick={() => set((s) => ({ ...s, lesionLinks: { maxMm, manual: {} } }))}>
                {tr("Manuelle Zuordnungen zurücksetzen")}
              </button>
            )}
          </div>
        )}
        {measurementStale && (
          <InfoText warn details={tr("Seit der letzten Messung haben sich Labelbilder geändert – z. B. Läsionen in „Segmentierung & Läsionen“ bestätigt oder abgewählt, eine Organkarte neu segmentiert oder die Läsionszuordnung korrigiert. Die Ergebnisse unten beruhen noch auf dem alten Stand.")}>
            {tr("Labelbilder geändert – neu messen")}
          </InfoText>
        )}
        <button className="primary-btn" disabled={!!busy || !tpViews.length || !setup.labelSets.length || !allCalibrated} onClick={() => void measure()}>
          {tr("Aktivitäten messen")}
        </button>
        {!allCalibrated && <p className="tool-hint">{tr("Kalibrierung unvollständig: Kamera-Profil (Nuklid und Kalibrierung) bzw. Aufnahmedauer fehlt.")}</p>}
      </Card>

      <Card title={<>{tr("Kurven und Dosis")}</>} persistKey="dos-res" status={rows.length ? { text: tr("{length} Regionen", { length: rows.length }), tone: "ok" } : null}
        info={tr("Je Region: Aktivität (MBq, ggf. durch den Recovery-Koeffizienten geteilt) über der Zeit, Fit und zeitintegrierte Aktivität (TIA). Automatisch: 1 Zeitpunkt → Hänscheid (bzw. Madsen mit T_eff), 2 → monoexponentiell, ≥ 3 → biexponentiell mit Aufnahmephase, wenn die Aktivität zwischen den ersten Zeitpunkten noch steigt, sonst monoexponentiell. Die Auswaschung ist nie langsamer als der physikalische Zerfall. Dosis = TIA × Elektronenenergie / Masse (lokale Energiedeposition; Masse aus CT-Dichte). BED = D + D²·λ / ((μ + λ)·α/β) für jede Region mit α/β und Reparatur-Halbwertszeit (Region anklicken; Nieren: Vorgabe unten), mit der effektiven Halbwertszeit des Fits. D2/D50/D98 aus der Voxel-Dosiskarte.")}>
        {measurementStale && rows.length > 0 && (
          <InfoText warn details={tr("Labelbilder haben sich seit der Messung geändert (z. B. Läsionen in „Segmentierung & Läsionen“ bestätigt oder abgewählt). Unter „Regionen“ erneut „Aktivitäten messen“.")}>
            {tr("Veraltet – Labelbilder geändert")}
          </InfoText>
        )}
        {rows.length === 0 ? (
          <InfoText details={tr("Zeitpunkte, Kalibrierung und Regionen festlegen, dann „Aktivitäten messen“.")}>{tr("Noch keine Messwerte")}</InfoText>
        ) : (
          <>
            {sel && (
              <>
                <Chart series={chart} xLabel={tr("Zeit p.i. (h)")} yLabel={tr("{name} (MBq)", { name: sel.name })} />
                <div className="field-row">
                  <label className="field">
                    {tr("Modell ({name})", { name: sel.name })}
                    <select value={sel.opts.model} onChange={(e) => setRegion(sel.key, { model: e.target.value as TacModel | "auto" })}>
                      <option value="auto">{tr("automatisch")}</option>
                      {(Object.keys(TAC_MODEL_LABELS) as TacModel[]).map((m) => (
                        <option key={m} value={m}>
                          {TAC_MODEL_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    {tr("T_eff Population (h)")}
                    <input type="text" inputMode="decimal" placeholder={tr("für Madsen")} value={sel.opts.teffH ?? ""} onChange={(e) => setRegion(sel.key, { teffH: numOrUndef(e.target.value) })} />
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    {tr("α/β (Gy) für BED")}
                    <input type="text" inputMode="decimal" placeholder={bedParams(sel.name, { ...sel.opts, alphaBeta: undefined }).alphaBeta?.toString() ?? "–"} value={sel.opts.alphaBeta ?? ""} onChange={(e) => setRegion(sel.key, { alphaBeta: numOrUndef(e.target.value) })} />
                  </label>
                  <label className="field">
                    {tr("Reparatur-T½ (h)")}
                    <input type="text" inputMode="decimal" placeholder={bedParams(sel.name, { ...sel.opts, repairH: undefined }).repairH?.toString() ?? "–"} value={sel.opts.repairH ?? ""} onChange={(e) => setRegion(sel.key, { repairH: numOrUndef(e.target.value) })} />
                  </label>
                </div>
                {sel.t.length < tpViews.length && (
                  <p className="tool-hint tool-warning">
                    {sel.name}: nur an {sel.t.length} von {tpViews.length} Zeitpunkten gemessen – unter „Regionen“ die Labelbilder von T1 für alle Zeitpunkte nehmen oder die fehlenden Organkarten segmentieren, dann neu messen.
                  </p>
                )}
                {sel.fit.note && <p className="tool-hint">{sel.fit.note}</p>}
                {(() => {
                  const aw = akaikeWeights(sel.t, sel.a, { physHalfLifeH: halfLifeH });
                  if (!aw.weights.length) return sel.t.length > 1 ? <p className="tool-hint">{tr("Akaike-Gewichte ab 4 Zeitpunkten (Vergleich mono/biexponentiell ab 5).")}</p> : null;
                  return (
                    <p className="tool-hint" title={tr("Akaike-Gewichte (AICc) der vergleichbaren Modelle und die damit gewichtete TIA (OpenDose3D-Ansatz); das Ergebnis oben nutzt weiterhin das gewählte bzw. automatisch bestimmte Modell.")}>
                      Akaike-Gewichte: {aw.weights.map((w) => `${TAC_MODEL_LABELS[w.model]} ${Math.round(w.weight * 100)} %`).join(" · ")} · gewichtete TIA {fmt(aw.averagedTia)} MBq·h
                    </p>
                  );
                })()}
                {sel.unc && (
                  <p className="tool-hint">
                    Unsicherheit der Dosis (k = 1): ± {pct(sel.unc.rel)} – {sel.unc.parts.map((p) => `${p.label} ${pct(p.rel)}`).join(" · ")}
                  </p>
                )}
                {selDvh && <Chart series={[{ label: "DVH", x: selDvh.curve.dose, y: selDvh.curve.volumePct, style: "line", color: "#2f9e44" }]} xLabel={tr("Dosis (Gy)")} yLabel={tr("{name}: Volumen (%)", { name: sel.name })} />}
              </>
            )}
            <p className="tool-hint">Zeile anklicken = Kurve, Fit und DVH der Region.</p>
            <BigTable title={tr("Dosimetrie · {nuclideId}", { nuclideId })} onCsv={downloadCsv}>
              <table className="region-table label-stats-table">
                <thead>
                  <tr>
                    <th>{tr("Region")}</th>
                    <th>{tr("Masse (g)")}</th>
                    <th>{tr("Modell")}</th>
                    <th>T_eff (h)</th>
                    <th>{tr("TIA (MBq·h)")}</th>
                    <th>{tr("Dosis (Gy)")}</th>
                    <th>BED (Gy)</th>
                    <th>D2/D50/D98 (Gy)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const d = dvhs.get(r.key);
                    return (
                      <tr key={r.key} className={r.key === sel?.key ? "reference-row clickable" : "clickable"} onClick={() => setSelected(r.key)}>
                        <td>
                          {r.name}
                          {r.t.length < tpViews.length && (
                            <span className="tool-warning" title={tr("Nur an {length} von {length2} Zeitpunkten gemessen – für die übrigen fehlt ein Labelbild mit dieser Region (Quelle der Labelbilder oben unter „Regionen“).", { length: r.t.length, length2: tpViews.length })}>
                              {" "}
                              ({r.t.length}/{tpViews.length})
                            </span>
                          )}
                        </td>
                        <td>{fmt(r.massG)}</td>
                        <td>{TAC_MODEL_LABELS[r.fit.model]}</td>
                        <td>{fmt(r.fit.teffH)}</td>
                        <td>
                          {fmt(r.fit.tia)}
                          {pm(r.fit.tiaSd, r.fit.tia)}
                        </td>
                        <td>
                          {fmt(r.doseGy)}
                          {pm(r.doseSdGy, r.doseGy)}
                        </td>
                        <td title={r.bed === undefined ? (r.fit.teffH ? tr("α/β und Reparatur-T½ für diese Region eintragen (Zeile anklicken)") : tr("BED nur mit effektiver Halbwertszeit")) : undefined}>
                          {r.bed !== undefined ? fmt(r.bed) : <span className="tool-hint">–</span>}
                        </td>
                        <td title={d ? undefined : doseEntry ? tr("Nur Labelbilder von T1 oder „alle Zeitpunkte“ (die Dosiskarte liegt im Raster von T1)") : tr("D2/D50/D98 kommen aus der Voxel-Dosiskarte – dort „Dosiskarte berechnen“")}>
                          {d ? `${fmt(d.d2)} / ${fmt(d.d50)} / ${fmt(d.d98)}` : <span className="tool-hint">{doseEntry ? tr("nicht auf T1") : tr("nach Voxelkarte")}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </BigTable>
            <div className="button-row">
              <button className="primary-btn" onClick={() => setReportView(reportHtml())}>
                {tr("Bericht anzeigen")}
              </button>
              <button className="secondary-btn" onClick={downloadReport}>
                HTML
              </button>
              <button className="secondary-btn" onClick={printReport}>
                PDF
              </button>
            </div>
            <InfoText details={tr("Bericht mit allen Zwischenergebnissen: Zeitpunkte (Datum, t p.i., Dauer, Kalibrierung), Aktivitäten je Region, Modell und Parameter, Akaike-Gewichte, TIA und Dosis mit Unsicherheit, BED, DVH-Kennwerte, Methodenvergleich lokal/Kernel, Methodik und Quellen. „Bericht anzeigen“ öffnet ihn groß über dem Viewer (dort drucken oder als PDF speichern); „HTML“ lädt ihn herunter, „PDF“ öffnet direkt den Druckdialog.")}>
                {tr("Bericht mit allen Zwischenergebnissen")}
              </InfoText>
            <div className="field-row">
              <label className="field">
                {tr("Vorgabe Nieren α/β (Gy)")}
                <input type="text" inputMode="decimal" value={setup.bed.alphaBeta} onChange={(e) => set((s) => ({ ...s, bed: { ...s.bed, alphaBeta: numOrUndef(e.target.value) ?? s.bed.alphaBeta } }))} />
              </label>
              <label className="field">
                {tr("Reparatur-T½ (h)")}
                <input type="text" inputMode="decimal" value={setup.bed.repairHalfTimeH} onChange={(e) => set((s) => ({ ...s, bed: { ...s.bed, repairHalfTimeH: numOrUndef(e.target.value) ?? s.bed.repairHalfTimeH } }))} />
              </label>
            </div>
            <div className="field-row three">
              {(
                [
                  ["calibrationPct", "u Kalibr. %"],
                  ["rcPct", "u RC %"],
                  ["volumePct", "u Volumen %"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="field">
                  {label}
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="–"
                    value={setup.uncertainty?.[k] ?? ""}
                    onChange={(e) => set((s) => ({ ...s, uncertainty: { ...s.uncertainty, [k]: numOrUndef(e.target.value) } }))}
                  />
                </label>
              ))}
            </div>
            <InfoText details={tr("Relative Standardunsicherheiten (k = 1) nach dem EANM-Leitfaden (Gear et al., EJNMMI Physics 2018), quadratisch addiert mit der Unsicherheit des Kurvenfits: Kalibrierfaktor (z. B. Streuung wiederholter Phantommessungen), Recovery-Koeffizient (nur Regionen mit RC) und segmentiertes Volumen (Masse ∝ Volumen). Keine Vorgabewerte – aus eigenen Messungen bestimmen. Ohne Eingabe zählt nur der Fit.")}>
              {tr("Unsicherheit nach EANM 2018")}
            </InfoText>
          </>
        )}
      </Card>

      <Card title={<>{tr("Voxel-Dosiskarte")}</>} persistKey="dos-voxel" defaultOpen={false} status={doseEntry ? { text: tr("erstellt"), tone: "ok" } : null}
        info={tr("Dosiskarte auf dem Raster des SPECT von Zeitpunkt 1. Alle Zeitpunkte werden über die Registrierung abgetastet; je Voxel Trapez + Ausläufer oder monoexponentieller Fit (log-linear), bei einem Zeitpunkt Hänscheid. Dosis: lokale Energiedeposition der Elektronen mit CT-Dichte oder Faltung mit einem geladenen Dosis-Voxel-Kernel (enthält auch Photonen; Dichte-Skalierung ρ_Wasser/ρ). DVH je Region aus der Karte.")}>
        <div className="field-row">
          <label className="field">
            {tr("Integration je Voxel")}
            <select value={setup.voxel.method} onChange={(e) => set((s) => ({ ...s, voxel: { ...s.voxel, method: e.target.value as "trapezoid" | "mono" } }))}>
              <option value="mono">{tr("Monoexponentiell (log-linear)")}</option>
              <option value="trapezoid">{tr("Trapez + Ausläufer")}</option>
            </select>
          </label>
        </div>
        <div className="field-row three">
          <label className="field">
            {tr("Kernel-Voxel (mm)")}
            <input type="text" inputMode="decimal" placeholder={tpViews[0] ? byId(tpViews[0].spectId)?.dataset.current.geometry.spacing[0].toFixed(2) : ""} value={kernelVoxel} onChange={(e) => setKernelVoxel(e.target.value)} />
          </label>
          <label className="field">
            {tr("Einheit")}
            <select value={kernelUnit} onChange={(e) => setKernelUnit(e.target.value as typeof kernelUnit)}>
              <option value="mGy/MBq·s">{tr("mGy/(MBq·s)")}</option>
              <option value="Gy/MBq·s">{tr("Gy/(MBq·s)")}</option>
              <option value="Gy/Bq·s">Gy/(Bq·s)</option>
            </select>
          </label>
          <label className="field">
            {tr("Kernel-Tabelle")}
            <input type="file" accept=".txt,.csv,.dat,text/plain" onChange={(e) => e.target.files?.[0] && void loadKernel(e.target.files[0])} />
          </label>
        </div>
        <p className="tool-hint">
          {setup.voxel.kernel ? (
            <>
              Kernel: {setup.voxel.kernel.name} ({setup.voxel.kernel.voxelMm} mm, Radius {setup.voxel.kernel.radius} Voxel){" "}
              <button className="link-btn" onClick={() => set((s) => ({ ...s, voxel: { ...s.voxel, kernel: undefined } }))}>
                {tr("entfernen")}
              </button>
            </>
          ) : (
            <span title={tr("Ohne Kernel: lokale Energiedeposition (Lu-177, Tb-161; für I-131 und Y-90 fehlen dann Photonen bzw. die β-Reichweite). Kernel-Tabelle: Zeilen „i j k S“, z. B. Voxel-S-Werte nach Lanconelli 2012 für die passende Voxelgröße.")}>
              {tr("Ohne Kernel: lokale Deposition")}
            </span>
          )}
        </p>
        <button className="primary-btn" disabled={!!busy || !tpViews.length || !allCalibrated || energy === undefined} onClick={() => void doseMap()}>
          {doseEntry ? tr("Dosiskarte neu berechnen") : "Dosiskarte berechnen"}
        </button>
        {doseEntry && (
          <button className="secondary-btn" onClick={() => api.showDataset(doseEntry.id)}>
            {tr("Dosiskarte anzeigen")}
          </button>
        )}
        {busy === "Dosiskarte" && (
          <button className="secondary-btn" onClick={() => voxelRun.current?.cancel()}>
            {tr("Abbrechen")}
          </button>
        )}
        {methodCmp && methodCmp.size > 0 && (
          <>
            <InfoText details={tr("Mittlere Dosis je Region aus der Voxelkarte: lokale Energiedeposition der Elektronen (mit CT-Dichte) gegenüber der Kernel-Faltung (Elektronen und Photonen, Dichte-Skalierung ρ_Wasser/ρ). Große Abweichungen bei kleinen Regionen (Kreuzbestrahlung, β-Reichweite) und bei Photonenstrahlern (I-131) sind zu erwarten; in Lunge und Knochen ist auch die Faltung nur eine Näherung.")}>
              {tr("Methodenvergleich lokal / Kernel")}
            </InfoText>
            <table className="region-table">
              <thead>
                <tr>
                  <th>{tr("Region")}</th>
                  <th>{tr("lokal (Gy)")}</th>
                  <th>{tr("Kernel (Gy)")}</th>
                  <th>Δ</th>
                </tr>
              </thead>
              <tbody>
                {[...methodCmp].map(([key, v]) => (
                  <tr key={key}>
                    <td>{labelNames.get(key) ?? key}</td>
                    <td>{fmt(v.led)}</td>
                    <td>{fmt(v.kernel)}</td>
                    <td>{Number.isFinite(v.led) && v.led > 0 ? `${((100 * (v.kernel - v.led)) / v.led).toFixed(1).replace(".", ",")} %` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      {reportView && <ReportOverlay html={reportView} title={tr("Dosimetrie-Bericht · {nuclideId}", { nuclideId })} onDownload={downloadReport} onClose={() => setReportView(null)} />}
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
  return p?.note ? <p className="tool-hint">{tr("Kalibrierung: {note}", { note: tr(p.note) })}</p> : null;
}

const labelHashes = new WeakMap<Float32Array, number>();
/** Content hash of a label image (cached per array: label maps change by replacing the array). */
function labelHash(data: Float32Array): number {
  let h = labelHashes.get(data);
  if (h === undefined) {
    h = 0;
    for (let i = 0; i < data.length; i++) if (data[i]) h = (h * 31 + data[i] * ((i % 65521) + 1)) % 2147483647;
    labelHashes.set(data, h);
  }
  return h;
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
  const [draft, setDraft] = useState<{ name: string; cps: string; collimator: string; window: string; rc: string; quantitative: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The built-in quantitative profile is always offered first.
  const own = profiles.filter((p) => !isBuiltinProfile(p));
  const list = [QUANT_PROFILE, ...own, ...(current && !isBuiltinProfile(current) && !own.some((p) => p.id === current.id) ? [current] : [])];
  const cur = current ?? QUANT_PROFILE;
  const edit = (p?: CameraProfile) =>
    setDraft({
      name: p ? (isBuiltinProfile(p) ? tr("xSPECT Quant mit RC") : p.name) : "",
      cps: p && !p.quantitative ? String(p.cpsPerMBq) : "",
      collimator: p?.collimator ?? "",
      window: p?.window ?? "",
      rc: (p?.recovery ?? []).map((r) => `${r.volumeMl}:${r.rc}`).join("; "),
      quantitative: p ? !!p.quantitative : false,
    });
  function commit() {
    if (!draft) return;
    const cps = Number(draft.cps.replace(",", "."));
    if (!draft.name.trim() || (!draft.quantitative && !(cps > 0))) return setErr(draft.quantitative ? "Name angeben." : tr("Name und Kalibrierfaktor (cps/MBq > 0) angeben – oder „quantitativ (Bq/ml)“ wählen."));
    const recovery = draft.rc
      .split(/[;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [v, r] = s.split(/[:=\s]+/).map((x) => Number(x.replace(",", ".")));
        return { volumeMl: v, rc: r };
      });
    if (recovery.some((r) => !(r.volumeMl > 0) || !(r.rc > 0) || r.rc > 1.5)) return setErr(tr("Recovery-Koeffizienten als „Volumen_ml:RC; …“ angeben, z. B. „0,5:0,3; 26,5:0,8“."));
    setErr(null);
    const keepId = current && !isBuiltinProfile(current) && draft.name === current.name;
    onSave({
      id: keepId ? current!.id : `cam${Date.now()}`,
      name: draft.name.trim(),
      nuclide: draft.quantitative ? tr("alle") : nuclide,
      cpsPerMBq: draft.quantitative ? 0 : cps,
      quantitative: draft.quantitative || undefined,
      collimator: draft.collimator || undefined,
      window: draft.window || undefined,
      recovery: recovery.length ? recovery : undefined,
    });
    setDraft(null);
  }
  return (
    <>
      <div className="field-row">
        <label className="field">
          {tr("Kamera-Profil")}
          <select value={cur.id} onChange={(e) => onSelect(list.find((p) => p.id === e.target.value))}>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.quantitative ? `${p.name}${isBuiltinProfile(p) ? "" : " · Bq/ml"}` : tr("{name} · {nuclide} · {cpsPerMBq} cps/MBq", { name: p.name, nuclide: p.nuclide, cpsPerMBq: p.cpsPerMBq })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!cur.quantitative && cur.nuclide !== nuclide && <p className="tool-hint tool-warning">Profil ist für {cur.nuclide} kalibriert, gewählt ist {nuclide}.</p>}
      <p className="tool-hint">
        {cur.quantitative ? tr("Quantitative Bilder (Bq/ml) – kein Kalibrierfaktor · ") : ""}
        {cur.collimator ? tr("Kollimator {collimator} · ", { collimator: cur.collimator }) : ""}
        {cur.window ? tr("Fenster {window} · ", { window: cur.window }) : ""}
        {cur.recovery?.length ? `RC: ${cur.recovery.map((r) => `${r.volumeMl} ml → ${r.rc}`).join(", ")}` : tr("keine Recovery-Koeffizienten")}
      </p>
      {draft ? (
        <div className="dos-profile">
          <div className="field-row">
            <label className="field">
              {tr("Name")}
              <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field">
              {tr("cps/MBq")}
              <input type="text" inputMode="decimal" disabled={draft.quantitative} placeholder={draft.quantitative ? tr("nicht nötig") : ""} value={draft.cps} onChange={(e) => setDraft({ ...draft, cps: e.target.value })} />
            </label>
          </div>
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.quantitative} onChange={(e) => setDraft({ ...draft, quantitative: e.target.checked })} />
            <span>{tr("Quantitativ (Bilder in Bq/ml, z. B. xSPECT Quant) – kein Kalibrierfaktor")}</span>
          </label>
          <div className="field-row">
            <label className="field">
              {tr("Kollimator")}
              <input type="text" value={draft.collimator} onChange={(e) => setDraft({ ...draft, collimator: e.target.value })} />
            </label>
            <label className="field">
              {tr("Energiefenster")}
              <input type="text" value={draft.window} onChange={(e) => setDraft({ ...draft, window: e.target.value })} />
            </label>
          </div>
          <label className="field">
            {tr("Recovery (Volumen ml : RC; …)")}
            <input type="text" value={draft.rc} placeholder="0,5:0,3; 1,2:0,45; 26,5:0,8" onChange={(e) => setDraft({ ...draft, rc: e.target.value })} />
          </label>
          <div className="button-row">
            <button className="primary-btn" onClick={commit}>
              {tr("Profil speichern")}
            </button>
            <button className="secondary-btn" onClick={() => setDraft(null)}>
              {tr("Abbrechen")}
            </button>
          </div>
        </div>
      ) : (
        <div className="chip-row">
          <button className="chip-btn" onClick={() => edit()}>
            {tr("Neu")}
          </button>
          <button className="chip-btn" onClick={() => edit(cur)} title={isBuiltinProfile(cur) ? tr("Als eigenes Profil mit Recovery-Koeffizienten speichern") : undefined}>
            {isBuiltinProfile(cur) ? tr("Mit RC als eigenes Profil") : tr("Ändern")}
          </button>
          {!isBuiltinProfile(cur) && (
            <button className="chip-btn" onClick={() => window.confirm(tr("Profil „{name}“ löschen?", { name: cur.name })) && (onDelete(cur.id), onSelect(undefined))}>
              {tr("Löschen")}
            </button>
          )}
        </div>
      )}
      <div className="button-row">
        <label className="link-btn">
          {tr("Profile importieren")}
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
          {tr("Profile exportieren")}
        </button>
      </div>
      {err && <p className="tool-hint tool-warning">{err}</p>}
    </>
  );
}
