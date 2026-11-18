import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Brain, Crosshair, Download, Eye, FileCode2, FolderOpen, Target, Wand2 } from "lucide-react";
import { NormalizationPanel, type NormMethod, type Regularization } from "./ui/NormalizationPanel";
import { type Normalization, REGULARIZATION_WEIGHT, sameGrid, describeCoregProgress, describeWarpProgress, fieldFromAffine, pullbackPositions } from "./normalization/model";
import { DEFAULT_WARP } from "./normalization/warp";
import { buildDeformationField, fieldCoverage, parseDeformationField } from "./normalization/yfield";
import { DeformationFieldCard } from "./ui/DeformationFieldCard";
import { CentiloidPanel, type CentiloidOutcome } from "./ui/CentiloidPanel";
import { TagInput } from "./ui/TagInput";
import { LabelList } from "./ui/LabelList";
import { filteredLabels, labelStats } from "./atlas/labelStats";
import { TumorPanel, type TumorIndication, type TumorMode } from "./ui/TumorPanel";
import { CtSegCard } from "./ui/CtSegCard";
import type { SegmentProgress } from "./segmentation/infer";
import { type CtSegRun, loadModelMeta, runCtSegmentation } from "./segmentation/ctSegment";
import type { CtSegBackend } from "./workers/ctseg.worker";
import { type Lesion, type ThresholdMethod, lesionStats } from "./tumor/segment";
import { burdenCsv, splitBurden, tumorBurden } from "./tumor/metrics";
import { EXCLUSION_PRESETS, annotateLesions, autoLiverCenter, organsOnGrid } from "./tumor/organs";
import { runTumorSegmentation } from "./tumor/runner";
import { transferVoi } from "./analysis/voiTransfer";
import { DatasetOverview } from "./components/DatasetOverview";
import { useStableRows, useStableVoi } from "./components/useStableRows";
import { FusionExportCard, type FusionFormat, type FusionGridMode } from "./ui/FusionExportCard";
import { axialGridCovering, buildFusionDicomSeries, buildFusionNifti, renderFusion } from "./export/fusionExport";
import { buildZip } from "./export/zip";
import { buildNiftiFile } from "./export/niftiWriter";
import { type CentiloidCalibration, acquisitionWindow, centiloidFromMeans, guessTracer, windowWarning } from "./centiloid/centiloid";
import { type CentiloidVois, VOI_LABELS, type VoiName, loadVois, voiMeans, voiVolumeMl } from "./centiloid/vois";
import { AtlasPanel, type RegionResult } from "./ui/AtlasPanel";
import { atlasFromLabels, loadBundledAtlas, parseLabelTable, pickAtlasEntries, regionStats } from "./atlas/atlas";
import { parseXmlLabelTable } from "./atlas/labelNifti";
import { LabelAnalysis, type LabelAnalysisResult } from "./ui/LabelAnalysis";
import { listZip } from "./core/unzip";
import { runWarp } from "./normalization/warpRunner";
import { runResample } from "./resample/runner";
import { type Interpolation, resampleAtPoints } from "./resample/resample";
import { CoregPanel, type CoregSettings } from "./ui/CoregPanel";
import { similarity } from "./registration/similarity";
import { type RegistrationRun, runCoregistration } from "./registration/runner";
import type { CoregProgress, CoregResult } from "./registration/coregister";
import { HeaderPanel } from "./ui/HeaderPanel";
import { AppShell, type ShellTab } from "./ui/AppShell";
import { DatasetInfo } from "./ui/DatasetInfo";
import { LayerSettings, type WindowPreset } from "./ui/ViewSettingsPanel";
import { type RegRow, type RegStatusKind, RegistrationSetup } from "./ui/RegistrationSetup";
import { RegistrationPanel } from "./ui/RegistrationPanel";
import { CT_PRESETS, datasetModality, defaultDisplay, isAnatomical, modalityLabel, rawUnitLabel, suvForSource, unitSource } from "./dataset/describe";
import { BUNDLED_MNI, BUNDLED_PET_TEMPLATES, SPM_TEMPLATE_ATTRIBUTION, SPM_TEMPLATE_LICENSE, loadBundledMni, loadBundledPetTemplate, loadPetTemplate } from "./normalization/templates";
import { AnalysisPanel } from "./components/AnalysisPanel";
import { type BrushState, FilterSection, GeometrySection, HistorySection, ValueSection, VoiSection, type VoiTool } from "./components/EditTools";
import { runEdits } from "./edit/runner";
import { type VoiShape, maskBounds, paintDisc, voiMask, voiStats } from "./edit/voi";
import { computeStats } from "./analysis/stats";
import type { SuvResult } from "./analysis/suv";
import { type UnitMode, formatInput, formatValue, parseInput } from "./components/format";
import { type LoadedDataset, createDataset } from "./dataset/types";
import { type EditOp, type VoiAction, changesGrid, countAffected } from "./edit/operations";
import { type LoadedVolume, decompressGzip, loadVolumeFromFiles } from "./viewer/volumeLoader";
import { UploadPanel } from "./components/UploadPanel";
import { VolumeUploadPanel } from "./components/VolumeUploadPanel";
import { ReconControls } from "./components/ReconControls";
import { ExportPanel } from "./components/ExportPanel";
import { buildSinogram } from "./recon/sinogram";
import type { ReconParams } from "./recon/volume";
import { reconstructVolume } from "./workers/workerPool";
import { Volume3D } from "./viewer/volume";
import { Viewer } from "./viewer/Viewer";
import { useShallowStable } from "./viewer/useShallowStable";
import type { LayerDisplay, LayoutKind, ViewKind, ViewerLayer } from "./viewer/types";
import { type Vec3, type WorldToVoxel, applyWorldToVoxel, voxelToWorld, volumeCenter, worldToVoxelTransform } from "./core/geometry";
import {
  IDENTITY_MAT4,
  IDENTITY_PARAMS,
  type Mat4,
  applyMat4,
  invert4,
  isRigid,
  type TransformFile,
  matrixFromParams,
  multiply4,
  paramsFromMatrix,
  parseTransformFile,
  transformedWorldToVoxel,
} from "./core/transform";
import type { SpectProjectionSet } from "./dicom/types";
import "./App.css";

/**
 * A loaded dataset. `matrix` maps its own patient coordinates to the reference dataset's world
 * (identity for the reference itself); it is kept in world space so it stays valid after edits that
 * change the voxel grid.
 */
interface Entry {
  id: string;
  dataset: LoadedDataset;
  display: LayerDisplay;
  matrix: Mat4;
  /** User tag (e.g. "Baseline") shown wherever the dataset is named. */
  tag?: string;
  /** Label images: labels shown in the viewer (undefined = all). */
  labelFilter?: number[];
}

/** Name of a dataset in lists and selections: tag (if any), modality, file/series name. */
function entryLabel(e: Entry): string {
  const base = `${datasetModality(e.dataset)} · ${e.dataset.displayName}`;
  return e.tag ? `${e.tag} – ${base}` : base;
}

/** Current (not yet applied) VOI on dataset `entryId`; `version` changes on every modification. */
interface VoiState {
  entryId: string;
  shape: VoiShape;
  version: number;
  /** Index-space bounding box of the painted voxels (mask VOIs). */
  bounds?: { min: Vec3; max: Vec3 } | null;
}

const VOI_DISPLAY: LayerDisplay = { window: [0.5, 1], lut: "voi", opacity: 0.4, visible: true };

let nextEntryId = 1;

function centerOf(v: Volume3D): Vec3 {
  return volumeCenter(v.geometry, [v.nx, v.ny, v.nz]);
}

/** Display settings for a dataset drawn on top of another one. */
function overlayDisplay(entry: Entry): LayerDisplay {
  const d = entry.display;
  if (isAnatomical(entry.dataset.source)) return { ...d, opacity: Math.min(d.opacity, 0.5), visible: true };
  return { ...d, lut: d.lut === "gray" ? "kidney" : d.lut, opacity: d.opacity === 1 ? 0.6 : d.opacity, visible: true };
}

function App() {
  const [projectionSet, setProjectionSet] = useState<SpectProjectionSet | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  /** Overlays drawn on top of the reference, bottom first. */
  const [overlayIds, setOverlayIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [threshold, setThreshold] = useState("");
  const [newValue, setNewValue] = useState("0");
  const [unitMode, setUnitMode] = useState<UnitMode>("raw");
  const [cursor, setCursor] = useState<Vec3 | null>(null);
  const [layout, setLayout] = useState<LayoutKind>("grid");
  const [focusView, setFocusView] = useState<ViewKind>("axial");
  const [activeTab, setActiveTab] = useState("data");
  const [panelOpen, setPanelOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [voi, setVoi] = useState<VoiState | null>(null);
  const [voiTool, setVoiTool] = useState<VoiTool>("sphere");
  const [sphereRadius, setSphereRadius] = useState(15);
  const [boxSize, setBoxSize] = useState<Vec3>([40, 40, 40]);
  const [brush, setBrush] = useState<BrushState>({ active: false, radius: 8, erase: false });
  const abortRef = useRef<AbortController | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [coregSettings, setCoregSettings] = useState<CoregSettings>({ dof: 6, cost: "auto", levels: [8, 4, 2], coarseSearch: false });
  const [coregProgress, setCoregProgress] = useState<CoregProgress | null>(null);
  const [coregRunning, setCoregRunning] = useState(false);
  /** Registration results per dataset (pending until accepted; previous matrix for discarding). */
  const [coregResults, setCoregResults] = useState<Record<string, { previous: Mat4; result: CoregResult; accepted: boolean }>>({});
  /** Datasets checked for registration (null = default selection). */
  const [regSelected, setRegSelected] = useState<string[] | null>(null);
  const [regQueue, setRegQueue] = useState<{ running: string | null; waiting: string[] }>({ running: null, waiting: [] });
  const regCancelled = useRef(false);
  const [coregError, setCoregError] = useState<string | null>(null);
  const coregRun = useRef<RegistrationRun | null>(null);
  const [normTemplateId, setNormTemplateId] = useState<string | null>(null);
  const [normSubjectId, setNormSubjectId] = useState<string | null>(null);
  const [normMethod, setNormMethod] = useState<NormMethod>("affine");
  const [normRegularization, setNormRegularization] = useState<Regularization>("medium");
  const [normUseMask, setNormUseMask] = useState(true);
  const [normSubjectKindOverride, setNormSubjectKindOverride] = useState<"T1" | "PET" | null>(null);
  const [normalization, setNormalization] = useState<Normalization | null>(null);
  const [normRunning, setNormRunning] = useState(false);
  const [normProgress, setNormProgress] = useState<{ stage: string; detail: string; fraction: number } | null>(null);
  const [normError, setNormError] = useState<string | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferStatus, setTransferStatus] = useState<string | null>(null);
  const [fieldStatus, setFieldStatus] = useState<string | null>(null);
  const [fusionBusy, setFusionBusy] = useState(false);
  const [fusionStatus, setFusionStatus] = useState<string | null>(null);
  // ── Tumor burden (MTV) ──
  const [tumorTargetId, setTumorTargetId] = useState<string | null>(null);
  const [tumorIndication, setTumorIndication] = useState<TumorIndication>("lymphoma");
  const [tumor, setTumor] = useState<{ entryId: string; labels: Int32Array; lesions: Lesion[]; description: string; version: number } | null>(null);
  const [tumorBusy, setTumorBusy] = useState(false);
  const [tumorError, setTumorError] = useState<string | null>(null);
  const [tumorMode, setTumorMode] = useState<TumorMode>("none");
  const [tumorBrushMm, setTumorBrushMm] = useState(6);
  const [tumorOrganId, setTumorOrganId] = useState<string | null | undefined>(undefined);
  const [tumorAutoExclude, setTumorAutoExclude] = useState(true);
  const [liverRef, setLiverRef] = useState<{ entryId: string; mean: number; sd: number; ml: number } | null>(null);
  const tumorStroke = useRef<{ id: number; time: number } | null>(null);
  const tumorScratch = useRef<Uint8Array | null>(null);
  const tumorStatsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ctSegRunning, setCtSegRunning] = useState(false);
  const [ctSegProgress, setCtSegProgress] = useState<SegmentProgress | null>(null);
  const [ctSegStatus, setCtSegStatus] = useState<string | null>(null);
  const [ctSegError, setCtSegError] = useState<string | null>(null);
  const ctSegRun = useRef<CtSegRun | null>(null);
  // WebGPU only counts with a real adapter (navigator.gpu alone exists in many browsers without one).
  const [webgpuAvailable, setWebgpuAvailable] = useState(false);
  useEffect(() => {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    gpu
      ?.requestAdapter()
      .then((a) => setWebgpuAvailable(!!a))
      .catch(() => setWebgpuAvailable(false));
  }, []);
  const [centiloidVois, setCentiloidVois] = useState<CentiloidVois | null>(null);
  const [centiloidRunning, setCentiloidRunning] = useState(false);
  const [centiloidStatus, setCentiloidStatus] = useState<string | null>(null);
  const [centiloidError, setCentiloidError] = useState<string | null>(null);
  const [centiloidOutcome, setCentiloidOutcome] = useState<CentiloidOutcome | null>(null);
  const centiloidCancelled = useRef(false);
  const normRun = useRef<{ cancel: () => void } | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      return localStorage.getItem("recon-studio-theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("recon-studio-theme", theme);
    } catch {
      /* storage unavailable: theme is not remembered */
    }
  }, [theme]);

  const sino = useMemo(() => (projectionSet ? buildSinogram(projectionSet) : null), [projectionSet]);

  const byId = (id: string | null) => entries.find((e) => e.id === id);
  const reference = byId(referenceId) ?? entries[0];
  const overlays = useShallowStable(overlayIds.flatMap((id) => (id !== reference?.id ? (byId(id) ?? []) : [])));
  /** Top-most overlay (default target of registration and transfers). */
  const overlay = overlays.at(-1);
  const active = byId(activeId) ?? reference;
  const dataset = active?.dataset ?? null;
  const volume = dataset?.current ?? null;
  const stats = useMemo(() => (volume ? computeStats(volume.data) : null), [volume]);

  // ── Units: SUV for every PET dataset with the needed header information. ──
  // Only the datasets' sources matter; `entries` changes on every display/edit update.
  const sourceKey = entries.map((e) => e.id).join("|");
  const suvById = useMemo(() => {
    const m = new Map<string, SuvResult | null>();
    for (const e of entries) m.set(e.id, suvForSource(unitSource(e.dataset)));
    return m;
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const unitFor = (e: Entry | undefined) => {
    if (!e) return { scale: 1, label: "" };
    const suv = suvById.get(e.id);
    if (unitMode === "suv" && suv?.ok) return { scale: suv.info.factor, label: "SUV" };
    return { scale: 1, label: rawUnitLabel(unitSource(e.dataset)) };
  };
  const activeSuv = active ? (suvById.get(active.id) ?? null) : null;
  const { scale, label: unitLabel } = unitFor(active);

  // ── World→voxel transforms (each dataset placed in the reference world by its matrix). ──
  const w2vById = useMemo(() => {
    const m = new Map<string, WorldToVoxel>();
    for (const e of entries) m.set(e.id, transformedWorldToVoxel(worldToVoxelTransform(e.dataset.current.geometry), e.matrix));
    return m;
  }, [entries]);
  const activeW2v = active ? (w2vById.get(active.id) ?? null) : null;

  // ── VOI: mask on the active dataset's grid, shown as a green overlay. ──
  const voiValid = voi && active && voi.entryId === active.id && volume;
  const voiMaskData = useMemo(() => (voiValid ? voiMask(volume!, voi!.shape) : null), [voiValid, volume, voi]);
  const voiBounds = useMemo(
    () => (voiMaskData && volume ? (voi?.shape.kind === "mask" ? (voi.bounds ?? null) : maskBounds(voiMaskData, volume.nx, volume.ny)) : null),
    [voiMaskData, volume, voi], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const voiStatistics = useMemo(
    () => (voiMaskData && volume && voiBounds ? voiStats(volume, voiMaskData, voiBounds) : null),
    [voiMaskData, volume, voiBounds],
  );

  // Included lesions as label image (color by lesion number) for the viewer.
  const tumorDisplay = useMemo(() => {
    if (!tumor) return null;
    const inc = new Set(tumor.lesions.filter((l) => l.included).map((l) => l.id));
    const out = new Float32Array(tumor.labels.length);
    for (let i = 0; i < out.length; i++) {
      const id = tumor.labels[i];
      if (id && inc.has(id)) out[i] = ((id - 1) % 254) + 1;
    }
    return out;
  }, [tumor]); // tumor.version changes with every edit (new object)

  // ── Viewer layers: reference at the bottom, overlay on top, VOI above. ──
  const layerUnits = new Map(entries.map((e) => [e.id, unitFor(e)]));
  const unitsKey = [...layerUnits.values()].map((u) => `${u.scale}:${u.label}`).join("|");
  const layers = useMemo<ViewerLayer[]>(() => {
    const out: ViewerLayer[] = [];
    const add = (e: Entry | undefined, display?: LayerDisplay) => {
      const w2v = e && w2vById.get(e.id);
      if (!e || !w2v) return;
      const volume = e.dataset.atlas && e.labelFilter ? filteredLabels(e.dataset.current, e.labelFilter) : e.dataset.current;
      out.push({ id: e.id, label: datasetModality(e.dataset), volume, w2v, display: display ?? e.display, unit: layerUnits.get(e.id) });
    };
    add(reference, reference ? { ...reference.display, opacity: 1 } : undefined);
    for (const o of overlays) add(o);
    const tEntry = tumor && byId(tumor.entryId);
    const tW2v = tEntry && w2vById.get(tEntry.id);
    if (tumor && tEntry && tW2v && tumorDisplay)
      out.push({
        id: "tumor",
        label: "Läsionen",
        volume: { nx: tEntry.dataset.current.nx, ny: tEntry.dataset.current.ny, nz: tEntry.dataset.current.nz, data: tumorDisplay, geometry: tEntry.dataset.current.geometry },
        w2v: tW2v,
        display: { window: [0, 255], lut: "labels", opacity: 0.55, visible: true, nearest: true },
        hideInStatus: true,
      });
    if (voiMaskData && volume && activeW2v)
      out.push({
        id: "voi",
        label: "VOI",
        volume: { nx: volume.nx, ny: volume.ny, nz: volume.nz, data: voiMaskData, geometry: volume.geometry },
        w2v: activeW2v,
        display: VOI_DISPLAY,
        hideInStatus: true,
      });
    return out;
  }, [reference, overlays, w2vById, unitsKey, voiMaskData, volume, activeW2v, voi, tumorDisplay]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateEntry(id: string, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  /** Shows a dataset as overlay (on top of the others). */
  function addOverlay(id: string) {
    setOverlayIds((prev) => [...prev.filter((x) => x !== id), id]);
  }

  function removeOverlay(id: string) {
    setOverlayIds((prev) => prev.filter((x) => x !== id));
  }

  /** Moves an overlay one position up (+1) or down (−1) in the stack. */
  function moveOverlay(id: string, dir: 1 | -1) {
    setOverlayIds((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function setDataset(id: string, next: LoadedDataset) {
    updateEntry(id, { dataset: next });
  }

  /** Resets the edit inputs to the maximum of the given dataset (in its display units). */
  function resetEditInputs(next: LoadedDataset, displayScale: number) {
    const s = computeStats(next.current.data);
    setThreshold(Number.isFinite(s.max) ? formatInput(s.max * displayScale) : "0");
    setNewValue("0");
  }

  // Mirror of the state relevant for adding datasets, so several datasets can be added in one go
  // (e.g. all series of an upload) without each call seeing stale state.
  const live = useRef({ entries, referenceId: reference?.id ?? null, activeId: active?.id ?? null });
  live.current = { entries, referenceId: reference?.id ?? null, activeId: active?.id ?? null };

  function addDataset(next: LoadedDataset): Entry {
    const L = live.current;
    const entry: Entry = { id: `ds${nextEntryId++}`, dataset: next, display: defaultDisplay(next.current, next.source), matrix: IDENTITY_MAT4 };
    if (next.atlas) entry.display = { window: [0, 255], lut: "labels", opacity: 0.45, visible: true, nearest: true };
    const ref = L.entries.find((e) => e.id === L.referenceId);
    const act = L.entries.find((e) => e.id === L.activeId);
    if ((next.template || next.atlas) && ref) {
      // Templates and atlases are added without changing reference, overlay or active dataset.
      setEntries((prev) => [...prev, entry]);
      live.current = { ...L, entries: [...L.entries, entry] };
      return entry;
    }
    const anatomical = isAnatomical(next.source) || next.template?.kind === "T1";
    let list = [...L.entries, entry];
    let referenceId = L.referenceId;
    if (!ref) {
      referenceId = entry.id;
      setReferenceId(entry.id);
      setOverlayIds([]);
    } else if (anatomical && !isAnatomical(ref.dataset.source)) {
      // CT/MR becomes the display base; the previous reference is shown on top.
      list = list.map((e) => (e.id === ref.id ? { ...e, display: overlayDisplay(e) } : e));
      referenceId = entry.id;
      setReferenceId(entry.id);
      addOverlay(ref.id);
    } else {
      list = list.map((e) => (e.id === entry.id ? { ...e, display: overlayDisplay(e) } : e));
      addOverlay(entry.id);
    }
    setEntries(list);
    setCursor(null);
    // A CT/MR added for fusion does not take over analysis/editing from an existing PET/SPECT.
    const becomesActive = !act || !anatomical || isAnatomical(act.dataset.source);
    let activeId = L.activeId;
    if (becomesActive) {
      activeId = entry.id;
      setActiveId(entry.id);
      setVoi(null);
      const suv = suvForSource(next.source);
      if (!anatomical) setUnitMode(suv?.ok ? "suv" : "raw");
      resetEditInputs(next, !anatomical && suv?.ok ? suv.info.factor : 1);
    }
    live.current = { entries: list, referenceId, activeId };
    return entry;
  }

  /** Makes another dataset the reference: all matrices are re-expressed in its world. */
  function makeReference(id: string) {
    const newRef = byId(id);
    if (!newRef || newRef.id === reference?.id) return;
    const inv = invert4(newRef.matrix);
    const oldRefId = reference?.id ?? null;
    setEntries((prev) =>
      prev.map((e) => {
        const matrix = e.id === id ? IDENTITY_MAT4 : multiply4(inv, e.matrix);
        const display = e.id === id ? { ...e.display, opacity: 1, visible: true } : e.id === oldRefId ? overlayDisplay(e) : e.display;
        return { ...e, matrix, display };
      }),
    );
    // Keep the displayed world point under the cursor.
    setCursor(null);
    setReferenceId(id);
    setOverlayIds((prev) => [...prev.filter((x) => x !== id && x !== oldRefId), ...(oldRefId ? [oldRefId] : [])]);
  }

  function makeOverlay(id: string | null) {
    if (id && id === reference?.id) return;
    if (id) {
      const e = byId(id);
      if (e) updateEntry(id, { display: overlayDisplay(e) });
    }
    if (id) addOverlay(id);
  }

  function switchActive(id: string) {
    const e = byId(id);
    if (!e || e.id === active?.id) return;
    setActiveId(id);
    setVoi(null);
    setBrush((b) => ({ ...b, active: false }));
    resetEditInputs(e.dataset, unitFor(e).scale);
  }

  function removeEntry(id: string) {
    const rest = entries.filter((e) => e.id !== id);
    if (id === reference?.id && rest.length > 0) {
      // The first remaining dataset becomes the reference; re-express the matrices in its world.
      const inv = invert4(rest[0].matrix);
      setEntries(rest.map((e, i) => ({ ...e, matrix: i === 0 ? IDENTITY_MAT4 : multiply4(inv, e.matrix), display: i === 0 ? { ...e.display, opacity: 1, visible: true } : e.display })));
      setReferenceId(rest[0].id);
      setOverlayIds((prev) => prev.filter((x) => x !== id && x !== rest[0].id));
    } else {
      setEntries(rest);
      removeOverlay(id);
    }
    if (id === active?.id) setActiveId(rest[0]?.id ?? null);
    if (voi?.entryId === id) setVoi(null);
  }

  const [templateBusy, setTemplateBusy] = useState(false);
  const [atlasBusy, setAtlasBusy] = useState(false);
  const [atlasError, setAtlasError] = useState<string | null>(null);

  async function addBundledTemplate() {
    setTemplateBusy(true);
    setError(null);
    try {
      addDataset(await loadBundledMni());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTemplateBusy(false);
    }
  }

  async function addBundledPetTemplate(id: (typeof BUNDLED_PET_TEMPLATES)[number]["id"]) {
    setTemplateBusy(true);
    setError(null);
    try {
      addDataset(await loadBundledPetTemplate(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTemplateBusy(false);
    }
  }

  function addOwnTemplate(loaded: LoadedVolume, fileName: string, kind: "T1" | "PET") {
    const d = createDataset(loaded.volume, loaded.source, fileName);
    addDataset({ ...d, template: { name: fileName, kind } });
  }

  function handleUnitModeChange(mode: UnitMode) {
    if (mode === unitMode || !activeSuv?.ok) return;
    const factor = mode === "suv" ? activeSuv.info.factor : 1 / activeSuv.info.factor;
    const convert = (text: string) => {
      const v = parseInput(text);
      return Number.isFinite(v) ? formatInput(v * factor) : text;
    };
    setThreshold(convert(threshold));
    setNewValue(convert(newValue));
    setUnitMode(mode);
  }

  function handleLoaded(set: SpectProjectionSet) {
    setProjectionSet(set);
    setError(null);
  }

  function handleVolumeLoaded(loaded: LoadedVolume, fileName: string) {
    if (!isAnatomical(loaded.source)) setProjectionSet(null);
    const d0 = createDataset(loaded.volume, loaded.source, fileName);
    const d = loaded.dynamic ? { ...d0, dynamic: loaded.dynamic } : d0;
    if (loaded.atlas) {
      // Label images (atlas, segmentation) come back as atlases: label colors, region list, region statistics.
      const hadReference = live.current.entries.some((e) => e.id === live.current.referenceId);
      const entry = addDataset({ ...d, atlas: loaded.atlas });
      if (hadReference) addOverlay(entry.id);
    } else addDataset(d);
    setError(null);
  }

  /** Runs edits in the worker and stores the result for the active dataset. */
  async function commit(entryId: string, base: LoadedDataset, from: "current" | "original", ops: EditOp[], edits: EditOp[]) {
    setEditBusy(true);
    setError(null);
    try {
      const { volume: next } = await runEdits(from === "current" ? base.current : base.original, ops);
      setDataset(entryId, { ...base, current: next, edits });
      if (ops.some(changesGrid) || (from === "original" && base.edits.some(changesGrid))) setVoi(null);
    } catch (e) {
      setError(`Bearbeitung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEditBusy(false);
    }
  }

  function handleApplyEdit(op: EditOp) {
    if (!dataset || !active || editBusy) return;
    void commit(active.id, dataset, "current", [op], [...dataset.edits, op]);
  }

  function handleUndo() {
    if (!dataset || !active || dataset.edits.length === 0 || editBusy) return;
    const edits = dataset.edits.slice(0, -1);
    void commit(active.id, dataset, "original", edits, edits);
  }

  function handleReset() {
    if (!dataset || !active) return;
    if (dataset.edits.some(changesGrid)) setVoi(null);
    setDataset(active.id, { ...dataset, current: dataset.original, edits: [] });
  }

  /** Converts a displayed world point to the active dataset's own world coordinates (undoing its transform). */
  function toNative(p: Vec3): Vec3 | null {
    if (!volume || !activeW2v) return null;
    const [i, j, k] = applyWorldToVoxel(activeW2v, p);
    return voxelToWorld(volume.geometry, i, j, k);
  }

  function placeVoi() {
    if (!volume || !active || !activeW2v) return;
    const center = cursor ? toNative(cursor) : centerOf(volume);
    if (!center) return;
    const shape: VoiShape = voiTool === "box" ? { kind: "box", center, size: boxSize } : { kind: "sphere", center, radius: sphereRadius };
    setBrush((b) => ({ ...b, active: false }));
    setVoi((v) => ({ entryId: active.id, shape, version: (v?.version ?? 0) + 1 }));
  }

  function paint(world: Vec3, normalAxis: 0 | 1 | 2) {
    if (!volume || !active) return;
    const center = toNative(world);
    if (!center) return;
    const reuse = voi && voi.entryId === active.id && voi.shape.kind === "mask" ? voi : null;
    const mask = reuse ? (reuse.shape as { mask: Uint8Array }).mask : new Uint8Array(volume.data.length);
    const box = paintDisc(volume, mask, center, brush.radius, normalAxis, brush.erase ? 0 : 1);
    const prev = reuse?.bounds;
    const bounds = prev
      ? { min: prev.min.map((v, a) => Math.min(v, box.min[a])) as Vec3, max: prev.max.map((v, a) => Math.max(v, box.max[a])) as Vec3 }
      : brush.erase
        ? null
        : box;
    setVoi({ entryId: active.id, shape: { kind: "mask", mask, dims: [volume.nx, volume.ny, volume.nz] }, version: (voi?.version ?? 0) + 1, bounds });
  }

  /** The VOI for an edit: analytic shapes as such, painted masks as an immutable copy. */
  function voiForEdit(): VoiShape | null {
    if (!voi || !volume) return null;
    return voi.shape.kind === "mask" ? { ...voi.shape, mask: Uint8Array.from(voi.shape.mask) } : voi.shape;
  }

  const countVoi = useMemo(
    () => (region: "inside" | "outside", action: VoiAction) =>
      voiMaskData && volume ? countAffected(volume, { type: "voi", voi: { kind: "mask", mask: voiMaskData, dims: [volume.nx, volume.ny, volume.nz] }, region, action }) : null,
    // `voi` changes on every brush stroke even though the mask array is modified in place.
    [voiMaskData, volume, voi], // eslint-disable-line react-hooks/exhaustive-deps
  );

  async function handleStart(params: ReconParams) {
    if (!sino || !projectionSet) return;
    setBusy(true);
    setProgress(0);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await reconstructVolume(sino, params, (frac) => setProgress(frac), controller.signal);
      const [spacingRow, spacingCol] = projectionSet.pixelSpacingMm;
      const voxelSpacingMm: [number, number, number] = [spacingRow, spacingCol, spacingCol];
      const vol = new Volume3D(result.data, result.rows, result.cols, result.cols, voxelSpacingMm);
      addDataset(createDataset(vol, { kind: "reconstruction", reconParams: params }, projectionSet.meta.sourceFileName));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(`Rekonstruktion fehlgeschlagen: ${String(e instanceof Error ? e.message : e)}`);
      }
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  // ── Coregistration: datasets → base (reference) ──
  const movingCandidates = entries.filter((e) => e.id !== reference?.id);
  const moving = byId(movingId) && movingId !== reference?.id ? byId(movingId) : (overlay ?? movingCandidates[0]);
  const costFor = (e: Entry | undefined): "ncc" | "nmi" => (e && reference && datasetModality(e.dataset) === datasetModality(reference.dataset) ? "ncc" : "nmi");
  const autoCost = costFor(moving);
  /** Labels, standard-space templates and derived datasets are not registered by intensity by default. */
  const isPassive = (e: Entry) => !!(e.dataset.atlas || e.dataset.derivedFrom || e.dataset.template);
  const regSelection = (regSelected ?? movingCandidates.filter((e) => !isPassive(e)).map((e) => e.id)).filter((id) => movingCandidates.some((e) => e.id === id));

  function selectMoving(id: string) {
    setMovingId(id);
    makeOverlay(id);
  }

  /** Registers the checked datasets one after another onto the base. */
  async function startCoregistration() {
    if (!reference || coregRunning) return;
    const ids = regSelection;
    if (!ids.length) return;
    setCoregError(null);
    setCoregProgress(null);
    setCoregRunning(true);
    regCancelled.current = false;
    try {
      for (const [n, id] of ids.entries()) {
        if (regCancelled.current) break;
        const e = byId(id);
        if (!e) continue;
        setRegQueue({ running: id, waiting: ids.slice(n + 1) });
        setMovingId(id);
        makeOverlay(id);
        const previous = coregResults[id] && !coregResults[id].accepted ? coregResults[id].previous : e.matrix;
        const run = runCoregistration(
          reference.dataset.current,
          e.dataset.current,
          { ...coregSettings, cost: coregSettings.cost === "auto" ? costFor(e) : coregSettings.cost, initial: e.matrix },
          setCoregProgress,
        );
        coregRun.current = run;
        const result = await run.promise;
        updateEntry(id, { matrix: result.matrix });
        setCoregResults((r) => ({ ...r, [id]: { previous, result, accepted: false } }));
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setCoregError(`Coregistrierung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCoregRunning(false);
      setRegQueue({ running: null, waiting: [] });
      coregRun.current = null;
    }
  }

  function acceptCoregistration(id: string) {
    setCoregResults((r) => (r[id] ? { ...r, [id]: { ...r[id], accepted: true } } : r));
  }

  function discardCoregistration(id: string) {
    const r = coregResults[id];
    if (r) updateEntry(id, { matrix: r.previous });
    setCoregResults((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
  }

  function discardResultOnly(id: string) {
    setCoregResults((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
  }

  /** New base: matrices are re-expressed; open results are accepted (their "previous" refers to the old base). */
  function changeBase(id: string) {
    setCoregResults((all) => Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { ...v, accepted: true }])));
    makeReference(id);
  }

  function saveMatrix() {
    if (!moving || !reference) return;
    const center = centerOf(moving.dataset.current);
    const file: TransformFile = {
      format: "recon-studio-transform",
      version: 1,
      matrix: moving.matrix,
      params: paramsFromMatrix(moving.matrix, center) ?? IDENTITY_PARAMS,
      center,
      moving: { name: moving.dataset.displayName, frameOfReferenceUid: moving.dataset.current.geometry.frameOfReferenceUid },
      reference: { name: reference.dataset.displayName, frameOfReferenceUid: reference.dataset.current.geometry.frameOfReferenceUid },
      method: coregResults[moving.id] ? `${coregSettings.dof === 6 ? "rigide" : "affin"}, ${coregResults[moving.id].result.cost}` : undefined,
      cost: coregResults[moving.id] ? { name: coregResults[moving.id].result.cost, before: coregResults[moving.id].result.before, after: coregResults[moving.id].result.after } : undefined,
      created: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${moving.dataset.displayName.replace(/[^A-Za-z0-9_.-]+/g, "_")}_to_${reference.dataset.displayName.replace(/[^A-Za-z0-9_.-]+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadMatrix(f: File) {
    if (!moving) return;
    try {
      const t = parseTransformFile(await f.text());
      updateEntry(moving.id, { matrix: t.matrix });
      discardResultOnly(moving.id);
      setCoregError(null);
    } catch (e) {
      setCoregError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Spatial normalization (standard space) ──
  const templateEntries = entries.filter((e) => e.dataset.template);
  const normTemplate = byId(normTemplateId)?.dataset.template ? byId(normTemplateId) : templateEntries[0];
  const subjectCandidates = entries.filter((e) => !e.dataset.template && !e.dataset.derivedFrom && !e.dataset.atlas);
  const normSubject =
    byId(normSubjectId) && !byId(normSubjectId)!.dataset.template ? byId(normSubjectId) : (subjectCandidates.find((e) => modalityLabel(e.dataset.source) === "MR") ?? subjectCandidates[0]);
  const guessedKind: "T1" | "PET" = normSubject && ["MR", "NIfTI"].includes(modalityLabel(normSubject.dataset.source)) ? "T1" : "PET";
  const subjectKind = normSubjectKindOverride ?? guessedKind;
  const sameContrast = !!normTemplate?.dataset.template && normTemplate.dataset.template.kind === subjectKind;
  const normCost = sameContrast ? "ncc" : "nmi";
  const normFor = normalization && normSubject && normalization.subjectId === normSubject.id ? normalization : null;

  /**
   * Affine (+ optional nonlinear) normalization of subject S to template T in a worker; progress goes to the
   * normalization panel, `normRun` holds the cancel handle.
   */
  async function estimateNormalization(
    T: Entry,
    S: Entry,
    opts: { nonlinear: boolean; cost: "ncc" | "nmi"; mask?: Float32Array; regularization: Regularization },
  ): Promise<Normalization> {
    const affineShare = opts.nonlinear ? 0.4 : 1;
    // Stage 1: whole head, NMI, coarse search (wide capture range); stage 2: brain mask, contrast cost.
    const rough = runCoregistration(
      T.dataset.current,
      S.dataset.current,
      { dof: 12, cost: "nmi", levels: [8, 4], coarseSearch: true, initial: IDENTITY_MAT4 },
      (p) => setNormProgress({ ...describeCoregProgress(p, affineShare / 2), stage: `Affin grob · Stufe ${p.level}/${p.levels}` }),
    );
    normRun.current = rough;
    const r0 = await rough.promise;
    const run = runCoregistration(
      T.dataset.current,
      S.dataset.current,
      { dof: 12, cost: opts.cost, levels: [4, 2], coarseSearch: false, initial: r0.matrix, fixedMask: opts.mask },
      (p) => setNormProgress({ ...describeCoregProgress(p, affineShare / 2), fraction: affineShare / 2 + describeCoregProgress(p, affineShare / 2).fraction, stage: `Affin fein · Stufe ${p.level}/${p.levels}` }),
    );
    normRun.current = run;
    const r = { ...(await run.promise), before: r0.before };
    const grid = { nx: T.dataset.current.nx, ny: T.dataset.current.ny, nz: T.dataset.current.nz, geometry: T.dataset.current.geometry };
    let n: Normalization = {
      subjectId: S.id,
      templateName: T.dataset.template?.name ?? T.dataset.displayName,
      grid,
      affine: r.matrix,
      field: fieldFromAffine(grid, r.matrix),
      kind: "affine",
      cost: { name: r.cost.toUpperCase(), before: -r.before, after: -r.after },
    };
    if (opts.nonlinear) {
      const t = T.dataset.current;
      const s = S.dataset.current;
      setNormProgress({ stage: "Nichtlinear", detail: "Vorbereitung", fraction: affineShare });
      const warp = runWarp(
        {
          template: { data: t.data, dims: [t.nx, t.ny, t.nz], geometry: t.geometry },
          subject: { data: s.data, dims: [s.nx, s.ny, s.nz], geometry: s.geometry },
          affine: r.matrix,
          weights: opts.mask,
          components: T.dataset.template?.components,
        },
        { ...DEFAULT_WARP, regularization: REGULARIZATION_WEIGHT[opts.regularization] },
        (p) => setNormProgress(describeWarpProgress(p, affineShare)),
      );
      normRun.current = warp;
      const w = await warp.promise;
      n = {
        ...n,
        field: w.field,
        kind: "nonlinear",
        warp: { foldedFraction: w.foldedFraction, maxDisplacementMm: w.maxDisplacementMm, costBefore: w.costBefore, costAfter: w.costAfter },
      };
    }
    return n;
  }

  function startNormalization() {
    const T = normTemplate;
    const S = normSubject;
    if (!T || !S || normRunning) return;
    setNormError(null);
    setNormProgress(null);
    setNormRunning(true);
    const mask = normUseMask ? (T.dataset.template?.mask ?? undefined) : undefined;
    estimateNormalization(T, S, { nonlinear: sameContrast && normMethod === "nonlinear", cost: normCost, mask, regularization: normRegularization })
      .then(async (n) => {
        setNormalization(n);
        // Quality check: show the normalized subject on the template right away.
        await transferToStandardSpace(n, [S.id], "linear", T);
      })
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setNormError(`Normalisierung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        setNormRunning(false);
        normRun.current = null;
      });
  }

  // ── Fusion export: the visible layers composited as in the viewer ──
  async function exportFusion(format: FusionFormat, gridMode: FusionGridMode, anonymize: boolean) {
    if (!reference) return;
    setFusionBusy(true);
    setFusionStatus("Wird berechnet …");
    try {
      await new Promise((r) => setTimeout(r, 0));
      const base = reference.dataset.current;
      const baseGrid = { nx: base.nx, ny: base.ny, nz: base.nz, geometry: base.geometry };
      const grid = gridMode === "axial" ? axialGridCovering(baseGrid) : baseGrid;
      const stack = [reference, ...overlays].filter((e) => e.display.visible);
      const fusionLayers = stack.flatMap((e) => {
        const w2v = w2vById.get(e.id);
        return w2v ? [{ volume: e.dataset.current, w2v, display: e.id === reference.id ? { ...e.display, opacity: 1 } : e.display }] : [];
      });
      const rgb = renderFusion(fusionLayers, grid);
      const name = `Fusion_${stack.map((e) => datasetModality(e.dataset)).join("_")}`.replace(/[^A-Za-z0-9_.-]+/g, "_");
      let bytes: Uint8Array<ArrayBuffer>;
      let fileName: string;
      if (format === "nifti") {
        bytes = buildFusionNifti(rgb, grid);
        fileName = `${name}.nii`;
      } else {
        const src = reference.dataset.source.kind === "dicom" ? reference.dataset.source.files[0].dataSet : undefined;
        const files = buildFusionDicomSeries(rgb, grid, { seriesDescription: `Fusion ${stack.map((e) => datasetModality(e.dataset)).join("+")}`, source: src, anonymize });
        bytes = buildZip(files.map((f) => ({ name: `${name}/${f.name}`, bytes: f.bytes })));
        fileName = `${name}.zip`;
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setFusionStatus(`${fileName}: ${grid.nx} × ${grid.ny} × ${grid.nz}, ${grid.geometry.spacing.map((v) => v.toFixed(2)).join(" × ")} mm.`);
    } catch (e) {
      setFusionStatus(`Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFusionBusy(false);
    }
  }

  // ── Tumor burden ──
  /** CT datasets: DICOM modality CT, or other (e.g. NIfTI) volumes with air values (< −500 HU). */
  const ctEntries = entries.filter((e) => {
    if (e.dataset.template || e.dataset.atlas || e.dataset.derivedFrom) return false;
    const m = datasetModality(e.dataset);
    if (m === "CT") return true;
    if (m !== "NIfTI") return false;
    const d = e.dataset.current.data;
    const step = Math.max(1, Math.floor(d.length / 20000));
    for (let i = 0; i < d.length; i += step) if (d[i] < -500) return true;
    return false;
  });
  const tumorTargets = entries.filter((e) => !e.dataset.template && !e.dataset.atlas && !isAnatomical(unitSource(e.dataset)) && !ctEntries.includes(e));
  const tumorEntry = byId(tumorTargetId) && tumorTargets.some((e) => e.id === tumorTargetId) ? byId(tumorTargetId) : (tumorTargets.find((e) => e.id === active?.id) ?? tumorTargets.find((e) => datasetModality(e.dataset) === "PT") ?? tumorTargets[0]);
  const tumorSuv = tumorEntry ? suvById.get(tumorEntry.id) : undefined;
  const tumorFactor = tumorSuv?.ok ? tumorSuv.info.factor : 1;

  const organEntries = entries.filter((e) => e.dataset.atlas);
  const organEntry = tumorOrganId === null ? undefined : (byId(tumorOrganId ?? null) ?? organEntries.findLast((e) => e.dataset.displayName.startsWith("CT-Organe")));

  /** Organ labels on the tumor PET grid (through both placements). */
  function organLabelsFor(pet: Entry, organs: Entry): Uint8Array | null {
    const w2v = w2vById.get(organs.id);
    if (!w2v) return null;
    return organsOnGrid(organs.dataset.current, transformedWorldToVoxel(w2v, invert4(pet.matrix)), pet.dataset.current);
  }

  async function runTumor(method: ThresholdMethod, minVolumeMl: number) {
    const e = tumorEntry;
    if (!e) return;
    setTumorBusy(true);
    setTumorError(null);
    try {
      const r = await runTumorSegmentation(e.dataset.current, { method, suvFactor: tumorFactor, minVolumeMl });
      let lesions = r.lesions;
      let description = r.description;
      if (organEntry?.dataset.atlas) {
        const organs = organLabelsFor(e, organEntry);
        if (organs) {
          const excluded = new Set(tumorAutoExclude ? EXCLUSION_PRESETS[tumorIndication] : []);
          lesions = annotateLesions(lesions, r.labels, organs, organEntry.dataset.atlas.labels, excluded);
          if (tumorAutoExclude) description += `; automatisch ausgeschlossen: ${EXCLUSION_PRESETS[tumorIndication].map((n) => n.replace(/_/g, " ")).join(", ")}`;
        }
      }
      setTumor({ entryId: e.id, labels: r.labels, lesions, description, version: 0 });
      setTumorMode("pick");
    } catch (err) {
      setTumorError(err instanceof Error ? err.message : String(err));
    } finally {
      setTumorBusy(false);
    }
  }

  /** Liver reference (mean ± SD in SUV) from the current VOI, transferred onto the tumor PET if drawn elsewhere. */
  function liverFromVoi() {
    const e = tumorEntry;
    if (!e || !overviewVoi) return;
    const row = overviewRows.find((r) => r.id === e.id);
    if (!row) return;
    const t = row.volume === overviewVoi.volume ? { mask: overviewVoi.mask } : transferVoi(overviewVoi, row);
    if (!t) return;
    let n = 0, s = 0, ss = 0;
    const d = e.dataset.current.data;
    for (let i = 0; i < t.mask.length; i++)
      if (t.mask[i] && Number.isFinite(d[i])) {
        const v = d[i] * tumorFactor;
        n++;
        s += v;
        ss += v * v;
      }
    if (!n) return;
    const mean = s / n;
    const [sx, sy, sz] = e.dataset.current.geometry.spacing;
    setLiverRef({ entryId: e.id, mean, sd: Math.sqrt(Math.max(0, ss / n - mean * mean)), ml: (n * sx * sy * sz) / 1000 });
  }

  /** Liver reference from the CT liver mask: 3 cm sphere in the right lobe, statistics on the PET. */
  function autoLiver() {
    const pet = tumorEntry;
    const organs = organEntry;
    const atlas = organs?.dataset.atlas;
    if (!pet || !organs || !atlas) return;
    const liverId = [...atlas.labels].find(([, n]) => n.replace(/ /g, "_") === "liver")?.[0];
    if (liverId === undefined) {
      setTumorError("Keine Leber in den Organmasken.");
      return;
    }
    const c = autoLiverCenter(organs.dataset.current, liverId, 15);
    if (!c) {
      setTumorError("Leber zu klein für eine 3-cm-Referenzkugel.");
      return;
    }
    const center = applyMat4(invert4(pet.matrix), applyMat4(organs.matrix, c));
    const v = pet.dataset.current;
    const mask = voiMask(v, { kind: "sphere", center, radius: 15 });
    let n = 0, sum = 0, ss = 0;
    for (let i = 0; i < mask.length; i++)
      if (mask[i] && Number.isFinite(v.data[i])) {
        const x = v.data[i] * tumorFactor;
        n++;
        sum += x;
        ss += x * x;
      }
    if (!n) return;
    const mean = sum / n;
    const [sx, sy, sz] = v.geometry.spacing;
    setLiverRef({ entryId: pet.id, mean, sd: Math.sqrt(Math.max(0, ss / n - mean * mean)), ml: (n * sx * sy * sz) / 1000 });
    // Show the sphere for checking (as VOI on the PET) and move the crosshair there.
    setVoi({ entryId: pet.id, shape: { kind: "sphere", center, radius: 15 }, version: (voi?.version ?? 0) + 1 });
    setCursor(applyMat4(pet.matrix, center));
    setTumorError(null);
  }

  /** Voxel index of a reference-world point on the tumor PET, or −1 outside. */
  function tumorIndexAt(world: Vec3): number {
    const e = tumor && byId(tumor.entryId);
    const w2v = e && w2vById.get(e.id);
    if (!e || !w2v) return -1;
    const v = e.dataset.current;
    const [x, y, z] = applyWorldToVoxel(w2v, world).map(Math.round);
    if (x < 0 || y < 0 || z < 0 || x >= v.nx || y >= v.ny || z >= v.nz) return -1;
    return (z * v.ny + y) * v.nx + x;
  }

  function toggleLesion(id: number) {
    setTumor((t) => (t ? { ...t, lesions: t.lesions.map((l) => (l.id === id ? { ...l, included: !l.included } : l)), version: t.version + 1 } : t));
  }

  const lastToggle = useRef<{ id: number; time: number } | null>(null);
  function tumorClick(world: Vec3) {
    const i = tumorIndexAt(world);
    const id = i >= 0 && tumor ? tumor.labels[i] : 0;
    if (!id) return;
    // A click also fires while dragging: toggle each lesion at most once per gesture.
    const now = performance.now();
    if (lastToggle.current && lastToggle.current.id === id && now - lastToggle.current.time < 600) {
      lastToggle.current.time = now;
      return;
    }
    lastToggle.current = { id, time: now };
    toggleLesion(id);
  }

  /** Brush on the lesion labels (add: into the lesion where the stroke starts or a new one; erase: remove). */
  function tumorPaint(world: Vec3, axis: 0 | 1 | 2) {
    const e = tumor && byId(tumor.entryId);
    if (!tumor || !e) return;
    const v = e.dataset.current;
    const now = performance.now();
    if (!tumorStroke.current || now - tumorStroke.current.time > 400) {
      const at = tumorIndexAt(world);
      const existing = at >= 0 ? tumor.labels[at] : 0;
      tumorStroke.current = { id: existing || tumor.lesions.reduce((m, l) => Math.max(m, l.id), 0) + 1, time: now };
    }
    tumorStroke.current.time = now;
    if (!tumorScratch.current || tumorScratch.current.length !== v.data.length) tumorScratch.current = new Uint8Array(v.data.length);
    const scratch = tumorScratch.current;
    const native = applyMat4(invert4(e.matrix), world);
    const box = paintDisc(v, scratch, native, tumorBrushMm, axis, 1);
    const add = tumorMode === "add";
    const labels = tumor.labels;
    for (let k = box.min[2]; k <= box.max[2]; k++)
      for (let j = box.min[1]; j <= box.max[1]; j++)
        for (let i = box.min[0]; i <= box.max[0]; i++) {
          const o = (k * v.ny + j) * v.nx + i;
          if (!scratch[o]) continue;
          scratch[o] = 0;
          if (add) {
            if (!labels[o]) labels[o] = tumorStroke.current.id;
          } else labels[o] = 0;
        }
    setTumor({ ...tumor, version: tumor.version + 1 });
    // Lesion statistics after the stroke settles.
    if (tumorStatsTimer.current) clearTimeout(tumorStatsTimer.current);
    tumorStatsTimer.current = setTimeout(() => {
      setTumor((t) => (t && t.labels === labels ? { ...t, lesions: lesionStats(v, labels, tumorFactor, t.lesions), version: t.version + 1 } : t));
    }, 300);
  }

  function gotoLesion(id: number) {
    const e = tumor && byId(tumor.entryId);
    const l = tumor?.lesions.find((x) => x.id === id);
    if (e && l) setCursor(applyMat4(e.matrix, l.centroid));
  }

  function downloadBytes(bytes: Uint8Array<ArrayBuffer>, name: string, type = "application/octet-stream") {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportTumorCsv() {
    const e = tumor && byId(tumor.entryId);
    if (!tumor || !e) return;
    const csv = burdenCsv(tumorBurden(tumor.lesions), tumor.lesions, { dataset: e.dataset.displayName, method: tumor.description, tlgLabel: tumorIndication === "psma" ? "TL-PSMA" : "TLG" });
    downloadBytes(new TextEncoder().encode("\ufeff" + csv) as Uint8Array<ArrayBuffer>, `Tumorlast_${e.dataset.displayName.replace(/[^A-Za-z0-9_.-]+/g, "_")}.csv`, "text/csv;charset=utf-8");
  }

  function exportTumorNifti() {
    const e = tumor && byId(tumor.entryId);
    if (!tumor || !e) return;
    const inc = new Set(tumor.lesions.filter((l) => l.included).map((l) => l.id));
    const data = new Float32Array(tumor.labels.length);
    for (let i = 0; i < data.length; i++) if (inc.has(tumor.labels[i])) data[i] = tumor.labels[i];
    const atlas = { name: `Läsionen · ${e.dataset.displayName}`, labels: new Map([...inc].sort((a, b) => a - b).map((id) => [id, `Läsion ${id}`] as [number, string])) };
    downloadBytes(buildNiftiFile(e.dataset.current.withData(data), { atlas }), `Laesionen_${e.dataset.displayName.replace(/\.nii(\.gz)?$/i, "").replace(/[^A-Za-z0-9_.-]+/g, "_")}.nii`);
  }

  // ── CT organ segmentation (browser, ONNX) ──
  function startCtSegmentation(ctId: string, backend: CtSegBackend) {
    const ct = byId(ctId);
    if (!ct || ctSegRunning) return;
    setCtSegRunning(true);
    setCtSegError(null);
    setCtSegStatus(null);
    setCtSegProgress(null);
    const t0 = performance.now();
    const run = runCtSegmentation(ct.dataset.current, backend, setCtSegProgress);
    ctSegRun.current = run;
    run.promise
      .then((r) => {
        const g = r.grid.geometry;
        const vol = new Volume3D(Float32Array.from(r.labels), r.grid.nz, r.grid.ny, r.grid.nx, [g.spacing[2], g.spacing[1], g.spacing[0]], { ...g, frameOfReferenceUid: ct.dataset.current.geometry.frameOfReferenceUid });
        const labels = new Map(Object.entries(r.meta.labels).filter(([k]) => k !== "0").map(([k, v]) => [Number(k), v.replace(/_/g, " ")]));
        const d = createDataset(vol, { kind: "reconstruction" }, `CT-Organe · ${ct.dataset.displayName}`);
        const entry = addDataset({ ...d, atlas: { name: `CT-Organe (TotalSegmentator) · ${ct.dataset.displayName}`, labels, attribution: "TotalSegmentator total 3 mm (Wasserthal et al. 2023), Apache-2.0" } });
        updateEntry(entry.id, { matrix: ct.matrix });
        addOverlay(entry.id);
        let n = 0;
        for (const v of r.labels) if (v) n++;
        setCtSegStatus(
          `Fertig in ${((performance.now() - t0) / 1000).toFixed(0)} s (${r.backend === "webgpu" ? "WebGPU" : "CPU"}): ${new Set(r.labels).size - 1} Strukturen, ${((n * g.spacing[0] * g.spacing[1] * g.spacing[2]) / 1e6).toFixed(1)} l segmentiert.${r.note ? ` ${r.note}.` : ""}`,
        );
      })
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setCtSegError(`CT-Segmentierung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        setCtSegRunning(false);
        setCtSegProgress(null);
        ctSegRun.current = null;
      });
  }

  // ── Centiloid ──
  async function loadCentiloidVois(files: File[]) {
    setCentiloidError(null);
    try {
      const v = await loadVois(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
      setCentiloidVois(v);
    } catch (e) {
      setCentiloidError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Adds the VOIs as a label dataset (1 = ctx, 2 = whole cerebellum, 3 = pons) for visual QC. */
  function showCentiloidVois() {
    if (!centiloidVois) return;
    const base = centiloidVois.volumes.ctx!;
    const labels = new Float32Array(base.data.length);
    const order: [VoiName, number][] = [["WhlCblBrnStm", 4], ["WhlCbl", 2], ["Pons", 3], ["ctx", 1]];
    for (const [name, value] of order) {
      const v = centiloidVois.volumes[name];
      if (!v || v.data.length !== labels.length) continue;
      for (let i = 0; i < labels.length; i++) if (v.data[i] > 0.5) labels[i] = value;
    }
    const table = new Map([[1, VOI_LABELS.ctx], [2, VOI_LABELS.WhlCbl], [3, VOI_LABELS.Pons], [4, "Hirnstamm (WhlCblBrnStm ohne Kleinhirn)"]]);
    const d = createDataset(base.withData(labels), { kind: "reconstruction" }, "Centiloid-VOIs");
    addDataset({ ...d, atlas: { name: "Centiloid-VOIs (GAAIN)", labels: table } });
  }

  /** VOI means, SUVR, CL and plausibility warnings for a dataset in MNI space. */
  function evaluateCentiloid(target: Entry, calibration: CentiloidCalibration, pipeline: string, extraWarnings: string[] = []): CentiloidOutcome {
    if (!centiloidVois) throw new Error("Zuerst die Centiloid-VOIs laden.");
    const means = voiMeans(target.dataset.current, centiloidVois);
    const result = centiloidFromMeans(means, calibration);
    const warnings = [...extraWarnings];
    const ctx = means.find((m) => m.name === "ctx");
    const ctxMl = centiloidVois.volumes.ctx ? voiVolumeMl(centiloidVois.volumes.ctx) : 0;
    if (ctx && ctxMl > 0 && ctx.volumeMl < 0.9 * ctxMl) warnings.push(`Nur ${Math.round((100 * ctx.volumeMl) / ctxMl)} % der Kortex-VOI liegen im Datensatz – liegt er im MNI-Raum?`);
    if (!Number.isFinite(result.centiloid)) warnings.push("Referenzregion ohne Daten – Centiloid nicht berechenbar.");
    const src = unitSource(target.dataset);
    if (src.kind === "dicom") {
      const w = acquisitionWindow(src.files[0].dataSet);
      if ("reason" in w) warnings.push(`Aufnahmezeitfenster nicht prüfbar: ${w.reason}`);
      else {
        const msg = windowWarning(w, calibration);
        if (msg) warnings.push(msg);
        const tracer = guessTracer(w.tracerName);
        if (tracer && calibration.tracer !== "custom" && tracer !== calibration.tracer) warnings.push(`Header nennt „${w.tracerName}“, Kalibrierung ist für ${calibration.tracer}.`);
      }
    }
    return { result, datasetLabel: target.dataset.derivedFrom?.name ?? target.dataset.displayName, pipeline, warnings };
  }

  function evaluateExisting(targetId: string, calibration: CentiloidCalibration) {
    const e = byId(targetId);
    if (!e) return;
    setCentiloidError(null);
    try {
      setCentiloidOutcome(
        evaluateCentiloid(
          e,
          calibration,
          "vorhandener Datensatz im MNI-Raum",
          calibration.pipeline === "recon" ? ["GAAIN-kalibrierte Gleichung: gilt nur, wenn der Datensatz mit der affinen Recon-Studio-Normalisierung (T1 → MNI) erstellt wurde – sonst die Standardgleichung wählen."] : [],
        ),
      );
    } catch (err) {
      setCentiloidError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Full pipeline. With T1: PET → T1 rigid (NMI), T1 → MNI T1 template (affine + nonlinear, brain mask),
   * PET through both into MNI. Without T1: PET → PET template directly. Then VOI evaluation.
   */
  async function runCentiloidPipeline(petId: string, t1Id: string | null, calibration: CentiloidCalibration) {
    const pet = byId(petId);
    const t1 = t1Id ? byId(t1Id) : null;
    if (!pet || centiloidRunning) return;
    centiloidCancelled.current = false;
    setCentiloidRunning(true);
    setCentiloidError(null);
    setCentiloidOutcome(null);
    const warnings: string[] = [];
    try {
      const overrides = new Map<string, Mat4>();
      let n: Normalization;
      let template: Entry;
      let pipeline: string;
      if (t1) {
        template = templateEntries.find((e) => e.dataset.template?.kind === "T1") ?? (setCentiloidStatus("MNI-Vorlage wird geladen …"), addDataset(await loadBundledMni()));
        setCentiloidStatus("1/4 PET → T1 coregistrieren …");
        // Coarse search always: PET and MRI often come from different sessions/scanners, and the Frame of
        // Reference UID is not a reliable indicator (anonymization, missing tags).
        const run = runCoregistration(t1.dataset.current, pet.dataset.current, {
          dof: 6,
          cost: "nmi",
          levels: [8, 4, 2],
          coarseSearch: true,
          initial: multiply4(invert4(t1.matrix), pet.matrix),
        });
        normRun.current = run;
        const reg = await run.promise;
        const petMatrix = multiply4(t1.matrix, reg.matrix);
        updateEntry(pet.id, { matrix: petMatrix });
        overrides.set(pet.id, petMatrix);
        // Affine only: against the GAAIN reference data the affine normalization agrees far better with the
        // Centiloid standard method (R² 0.990, slope 0.93) than with the additional nonlinear warp (R² 0.92, slope 0.78).
        setCentiloidStatus("2/4 T1 → MNI (affin) …");
        n = await estimateNormalization(template, t1, { nonlinear: false, cost: "ncc", mask: template.dataset.template?.mask ?? undefined, regularization: normRegularization });
        pipeline = "MRT-Pipeline (affin)";
        if (calibration.pipeline === "standard")
          warnings.push("Die gewählte Standardgleichung gilt für die SPM8-Standardmethode – für diese Pipeline die GAAIN-kalibrierte Gleichung wählen.");
      } else {
        const tpl = templateEntries.find((e) => e.dataset.template?.kind === "PET");
        if (!tpl) throw new Error("Für PET-only wird eine PET-Vorlage benötigt.");
        template = tpl;
        setCentiloidStatus("1/3 PET → PET-Vorlage (affin + nichtlinear) …");
        n = await estimateNormalization(template, pet, { nonlinear: true, cost: "ncc", mask: template.dataset.template?.mask ?? undefined, regularization: normRegularization });
        pipeline = "PET-only";
        warnings.push("PET-only ist nicht an den GAAIN-Daten validiert – Werte nur orientierend; bei Atrophie oder vaskulären Läsionen Normalisierung besonders prüfen.");
      }
      if (centiloidCancelled.current) return;
      if (n.warp && n.warp.foldedFraction > 0) warnings.push(`Verformung faltet sich in ${(100 * n.warp.foldedFraction).toFixed(2)} % der Hirnvoxel.`);
      setNormalization(n);
      setNormSubjectId(n.subjectId);
      setNormTemplateId(template.id);
      setCentiloidStatus(`${t1 ? "3/4" : "2/3"} In den MNI-Raum übertragen …`);
      const ids = t1 ? [t1.id, pet.id] : [pet.id];
      const created = await transferToStandardSpace(n, ids, "linear", template, overrides);
      const petStd = created.at(-1);
      if (!petStd) throw new Error("Übertragung in den MNI-Raum fehlgeschlagen.");
      setCentiloidStatus(`${t1 ? "4/4" : "3/3"} VOIs auswerten …`);
      setCentiloidOutcome(evaluateCentiloid(petStd, calibration, pipeline, warnings));
      setCentiloidStatus(null);
    } catch (e) {
      setCentiloidStatus(null);
      if (!(e instanceof DOMException && e.name === "AbortError")) setCentiloidError(`Centiloid-Bestimmung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCentiloidRunning(false);
      normRun.current = null;
    }
  }

  // ── Atlas / SUVR ──
  async function addBundledAtlas() {
    setAtlasBusy(true);
    setAtlasError(null);
    try {
      addDataset(await loadBundledAtlas());
    } catch (e) {
      setAtlasError(e instanceof Error ? e.message : String(e));
    } finally {
      setAtlasBusy(false);
    }
  }

  async function addOwnAtlas(input: File[]) {
    setAtlasError(null);
    let files = input;
    const zip = input.find((f) => /\.zip$/i.test(f.name));
    if (zip) {
      // e.g. the AAL3 download: label image + table inside the archive.
      try {
        const picked = pickAtlasEntries(listZip(await zip.arrayBuffer()));
        if (!picked) throw new Error(`In „${zip.name}“ wurde kein NIfTI-Labelbild gefunden.`);
        const toFile = async (e: { name: string; read: () => Promise<Uint8Array<ArrayBuffer>> }) => new File([await e.read()], e.name.split("/").pop()!);
        files = [await toFile(picked.image), ...(picked.table ? [await toFile(picked.table)] : [])];
      } catch (e) {
        setAtlasError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    const image = files.find((f) => /\.nii(\.gz)?$/i.test(f.name));
    const table = files.find((f) => f !== image);
    if (!image) {
      setAtlasError("Bitte das Labelbild (NIfTI) mit auswählen.");
      return;
    }
    try {
      const loaded = await loadVolumeFromFiles([image]);
      const labels = table ? parseLabelTable(await table.text()) : undefined;
      if (table && !labels?.size) throw new Error(`In „${table.name}“ wurden keine Labels erkannt.`);
      const d = createDataset(loaded.volume, loaded.source, image.name);
      addDataset({ ...d, atlas: labels || !loaded.atlas ? atlasFromLabels(loaded.volume.data, image.name.replace(/\.nii(\.gz)?$/i, ""), labels) : loaded.atlas });
    } catch (e) {
      setAtlasError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Atlas labels on the voxel grid of a dataset (nearest neighbour through the display registration). */
  function atlasLabelsFor(atlasEntry: Entry, target: Entry): Float32Array {
    const a = atlasEntry.dataset.current;
    const v = target.dataset.current;
    if (sameGrid({ nx: a.nx, ny: a.ny, nz: a.nz, geometry: a.geometry }, v) && atlasEntry.matrix.every((x, i) => Math.abs(x - target.matrix[i]) < 1e-9)) return a.data;
    const w2v = w2vById.get(atlasEntry.id);
    if (!w2v) throw new Error("Atlas ist nicht im Viewer verfügbar.");
    const pts = new Float32Array(v.nx * v.ny * v.nz * 3);
    for (let k = 0, o = 0; k < v.nz; k++)
      for (let j = 0; j < v.ny; j++)
        for (let i = 0; i < v.nx; i++, o += 3) pts.set(applyMat4(target.matrix, voxelToWorld(v.geometry, i, j, k)), o);
    return resampleAtPoints(a, w2v, pts, "nearest");
  }

  function computeRegions(atlasId: string, targetId: string): RegionResult {
    const A = byId(atlasId);
    const E = byId(targetId);
    if (!A?.dataset.atlas || !E) throw new Error("Atlas oder Datensatz nicht gefunden.");
    const v = E.dataset.current;
    const labels = atlasLabelsFor(A, E);
    const [sx, sy, sz] = v.geometry.spacing;
    const stats = regionStats(v.data, labels, A.dataset.atlas, (sx * sy * sz) / 1000);
    if (!stats.length) throw new Error("Keine Atlasregion überlappt mit dem Datensatz – liegt er im Standardraum des Atlas?");
    return { stats, unit: rawUnitLabel(unitSource(E.dataset)), datasetLabel: E.dataset.displayName };
  }

  /** Gives a label image without table its region names (TotalSegmentator organs or a label table file). */
  async function assignAtlasNames(entryId: string, src: "totalseg" | File) {
    setAtlasError(null);
    try {
      let table: Map<number, string>;
      let name: string | undefined;
      if (src === "totalseg") {
        const meta = await loadModelMeta();
        table = new Map(Object.entries(meta.labels).map(([k, v]) => [Number(k), v] as [number, string]).filter(([k]) => k > 0));
        name = "CT-Organe (TotalSegmentator)";
      } else {
        const text = await src.text();
        table = /<Label\b/.test(text) ? parseXmlLabelTable(text) : parseLabelTable(text);
        if (!table.size) throw new Error(`In „${src.name}“ wurden keine Labels erkannt.`);
      }
      const e = live.current.entries.find((x) => x.id === entryId);
      if (!e?.dataset.atlas) return;
      const atlas = atlasFromLabels(e.dataset.current.data, name ?? e.dataset.atlas.name, table);
      setDataset(entryId, { ...e.dataset, atlas: { ...atlas, attribution: src === "totalseg" ? "TotalSegmentator total (Wasserthal et al. 2023), Apache-2.0" : e.dataset.atlas.attribution } });
    } catch (err) {
      setAtlasError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Label-based analysis: statistics of a dataset per region of a label image (display units, e.g. SUV). */
  function computeLabelAnalysis(atlasId: string, targetId: string): LabelAnalysisResult {
    const A = byId(atlasId);
    const E = byId(targetId);
    if (!A?.dataset.atlas || !E) throw new Error("Labels oder Datensatz nicht gefunden.");
    const v = E.dataset.current;
    const labels = atlasLabelsFor(A, E);
    const { scale, label } = unitFor(E);
    const values = scale === 1 ? v.data : Float32Array.from(v.data, (x) => x * scale);
    const [sx, sy, sz] = v.geometry.spacing;
    const stats = regionStats(values, labels, A.dataset.atlas, (sx * sy * sz) / 1000);
    if (!stats.length) throw new Error("Keine Region überlappt mit dem Datensatz – liegen Labels und Datensatz im selben Raum (Registrierung, Standardraum)?");
    const a = A.dataset.current;
    const resampled = labels !== a.data;
    return {
      stats,
      values,
      labels,
      unit: label,
      datasetLabel: entryLabel(E),
      note: resampled ? `Labels „${entryLabel(A)}“ über die Registrierung auf das Raster von „${entryLabel(E)}“ übertragen (nächster Nachbar).` : undefined,
    };
  }

  function createSuvrImage(targetId: string, refMean: number, refLabel: string) {
    const E = byId(targetId);
    if (!E || !(refMean > 0)) return;
    const v = E.dataset.current;
    const data = new Float32Array(v.data.length);
    for (let i = 0; i < data.length; i++) data[i] = v.data[i] / refMean;
    const d = createDataset(v.withData(data), E.dataset.source, `${E.dataset.displayName} · SUVR`);
    const derived: LoadedDataset = { ...d, derivedFrom: { name: `${E.dataset.displayName} (SUVR, Referenz: ${refLabel})`, source: { kind: "reconstruction" }, space: E.dataset.derivedFrom?.space ?? "nativ", label: "SUVR" } };
    const id = `ds${nextEntryId++}`;
    setEntries((prev) => [...prev, { id, dataset: derived, display: { window: [0, 3], lut: "kidney", opacity: 0.6, visible: true }, matrix: E.matrix }]);
    addOverlay(id);
    setActiveId(id);
  }

  /** Imports an SPM / CAT12 y_*.nii as the normalization of the selected subject. */
  async function importDeformationField(file: File) {
    const S = normSubject;
    if (!S) return;
    setNormError(null);
    setFieldStatus("Wird gelesen …");
    try {
      let buffer = await file.arrayBuffer();
      const head = new Uint8Array(buffer, 0, 2);
      if (head[0] === 0x1f && head[1] === 0x8b) buffer = await decompressGzip(buffer);
      const parsed = parseDeformationField(buffer);
      const coverage = fieldCoverage(parsed.field, S.dataset.current);
      if (coverage < 0.3) {
        setFieldStatus(null);
        setNormError(
          `Das Feld zeigt nur zu ${Math.round(coverage * 100)} % in das Bild von „${S.dataset.displayName}“. Falsches Subjekt, ein inverses Feld (iy_*.nii statt y_*.nii) oder ein anders orientiertes Bild?`,
        );
        return;
      }
      const tpl = templateEntries.find((e) => sameGrid(parsed.grid, e.dataset.current));
      const n: Normalization = {
        subjectId: S.id,
        templateName: tpl?.dataset.template?.name ?? file.name.replace(/\.nii(\.gz)?$/i, ""),
        grid: parsed.grid,
        affine: IDENTITY_MAT4,
        field: parsed.field,
        kind: "imported",
      };
      setNormalization(n);
      const { nx, ny, nz, geometry } = parsed.grid;
      setFieldStatus(
        `${file.name}: ${nx} × ${ny} × ${nz}, ${geometry.spacing.map((v) => v.toFixed(2)).join(" × ")} mm; ${Math.round(coverage * 100)} % im Bild des Subjekts` +
          (parsed.invalidFraction > 0 ? `, ${(parsed.invalidFraction * 100).toFixed(1)} % ohne Zuordnung` : "") +
          (tpl ? ` – passt zur Vorlage ${tpl.dataset.template?.name}.` : " – Raster weicht von den geladenen Vorlagen ab; die übertragenen Datensätze bilden den Standardraum."),
      );
      await transferToStandardSpace(n, [S.id], "linear", tpl);
    } catch (e) {
      setFieldStatus(null);
      setNormError(`Verformungsfeld nicht lesbar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function exportDeformationField() {
    if (!normFor) return;
    const subject = byId(normFor.subjectId);
    const bytes = buildDeformationField(normFor);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `y_${(subject?.dataset.displayName ?? "subject").replace(/\.nii(\.gz)?$/i, "").replace(/[^A-Za-z0-9_.-]+/g, "_")}.nii`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Resamples datasets into the template space through the subject's deformation and adds them as new
   * datasets; the template becomes the reference and the first transferred non-anatomical dataset the overlay.
   */
  async function transferToStandardSpace(
    n: Normalization,
    ids: string[],
    method: Interpolation,
    templateEntry = normTemplate,
    /** Placements that changed in the same async flow (React state not yet updated). */
    matrixOverrides?: Map<string, Mat4>,
  ): Promise<Entry[]> {
    const subject = byId(n.subjectId);
    if (!subject) return [];
    const matrixOf = (e: Entry) => matrixOverrides?.get(e.id) ?? e.matrix;
    // The loaded template becomes the reference only if its grid is the field's grid (an imported CAT12
    // field may use another resolution); otherwise the transferred datasets carry the standard space.
    const tpl =
      (templateEntry && sameGrid(n.grid, templateEntry.dataset.current) ? templateEntry : undefined) ??
      entries.find((e) => (e.dataset.template || e.dataset.derivedFrom) && sameGrid(n.grid, e.dataset.current)) ??
      null;
    setTransferBusy(true);
    setTransferStatus(null);
    try {
      // Subject native → reference world: positions for every template voxel.
      const points = pullbackPositions(n, matrixOf(subject));
      const { nx, ny, nz, geometry } = n.grid;
      const created: Entry[] = [];
      for (const [i, id] of ids.entries()) {
        const e = byId(id);
        const w2v = e && (matrixOverrides?.has(id) ? transformedWorldToVoxel(worldToVoxelTransform(e.dataset.current.geometry), matrixOf(e)) : w2vById.get(id));
        if (!e || !w2v) continue;
        setTransferStatus(`${i + 1}/${ids.length}: ${datasetModality(e.dataset)} wird übertragen …`);
        const data = await runResample(e.dataset.current, w2v, points, method, (f) => setTransferStatus(`${i + 1}/${ids.length}: ${datasetModality(e.dataset)} ${Math.round(f * 100)} %`));
        const vol = tpl ? tpl.dataset.current.withData(data) : new Volume3D(data, nz, ny, nx, [geometry.spacing[2], geometry.spacing[1], geometry.spacing[0]], geometry);
        const source = tpl?.dataset.source.kind === "nifti" ? tpl.dataset.source : ({ kind: "reconstruction" } as const);
        const d = createDataset(vol, source, `${e.dataset.displayName} · ${n.templateName}`);
        const derived: LoadedDataset = { ...d, derivedFrom: { name: e.dataset.displayName, source: unitSource(e.dataset), space: n.templateName } };
        created.push({ id: `ds${nextEntryId++}`, dataset: derived, display: { ...e.display, opacity: 1, visible: true }, matrix: IDENTITY_MAT4 });
      }
      // Switch the display to the standard space.
      if (tpl) {
        const inv = invert4(tpl.matrix);
        setEntries((prev) => [...prev.map((x) => ({ ...x, matrix: x.id === tpl.id ? IDENTITY_MAT4 : multiply4(inv, x.matrix) })), ...created]);
        setReferenceId(tpl.id);
      } else if (created.length) {
        setEntries((prev) => [...prev, ...created]);
        setReferenceId((created.find((c) => isAnatomical(unitSource(c.dataset))) ?? created[0]).id);
      }
      const overlayEntry = created.find((c) => !isAnatomical(unitSource(c.dataset))) ?? created[0];
      if (overlayEntry) {
        // New space: the previous overlays (native space) are replaced by the transferred dataset.
        setOverlayIds([overlayEntry.id]);
        setEntries((prev) => prev.map((x) => (x.id === overlayEntry.id ? { ...x, display: overlayDisplay(x) } : x)));
      }
      setCursor(null);
      setTransferStatus(`${created.length} Datensatz/Datensätze im Standardraum angelegt (${nx} × ${ny} × ${nz}).`);
      return created;
    } catch (e) {
      setTransferStatus(null);
      setNormError(`Übertragung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    } finally {
      setTransferBusy(false);
    }
  }

  // ── Panels ──
  const presetsFor = (e: Entry): WindowPreset[] => {
    const v = e.dataset.current;
    if (datasetModality(e.dataset) === "CT") return CT_PRESETS;
    const suv = suvById.get(e.id);
    return [
      { label: "Auto", window: defaultDisplay(v, e.dataset.source).window },
      ...(suv?.ok ? [5, 10, 15].map((m) => ({ label: `SUV 0–${m}`, window: [0, m / suv.info.factor] as [number, number] })) : []),
    ];
  };

  // Manual registration of the moving dataset relative to the reference (parameters about its center).
  const movingCenter = moving ? centerOf(moving.dataset.current) : null;
  const movingParams = moving && movingCenter ? (paramsFromMatrix(moving.matrix, movingCenter) ?? IDENTITY_PARAMS) : IDENTITY_PARAMS;

  let frameNote: string | undefined;
  if (moving && reference) {
    const a = moving.dataset.current.geometry.frameOfReferenceUid;
    const b = reference.dataset.current.geometry.frameOfReferenceUid;
    if (!moving.dataset.current.hasPatientGeometry || !reference.dataset.current.hasPatientGeometry)
      frameNote = "Für mindestens einen Datensatz sind keine Patientenkoordinaten bekannt – die Ausrichtung muss manuell erfolgen.";
    else if (a && b && a !== b)
      frameNote = "Unterschiedliche Frame-of-Reference-UIDs: Die Datensätze stammen evtl. aus verschiedenen Untersuchungen – Grobsuche empfohlen.";
  }

  const roleBadges = (e: Entry) => (
    <span className="role-badges">
      {e.id === reference?.id && <span className="role-badge reference">Referenz</span>}
      {e.id === overlay?.id && <span className="role-badge overlay">Overlay</span>}
      {e.id === active?.id && entries.length > 1 && <span className="role-badge">aktiv</span>}
    </span>
  );

  const dataTab = (
    <>
      <VolumeUploadPanel
        title={entries.length ? "Weiteren Datensatz laden" : "Volumen laden"}
        onLoaded={handleVolumeLoaded}
        description="PET, SPECT, CT oder MRT als DICOM (Datei oder ganze Serie) bzw. NIfTI. Beliebig viele Datensätze; CT/MRT wird als Anzeige-Basis vorgeschlagen."
      />
      {entries.map((e) => (
        <DatasetInfo
          key={e.id}
          dataset={e.dataset}
          highlighted={e.id === active?.id && entries.length > 1}
          title={
            <>
              {e.tag ? `${e.tag} · ` : ""}
              {datasetModality(e.dataset)}
              {roleBadges(e)}
            </>
          }
          onRemove={() => removeEntry(e.id)}
        >
          <TagInput value={e.tag ?? ""} onChange={(t) => updateEntry(e.id, { tag: t || undefined })} />
          {entries.length > 1 && (
            <div className="chip-row">
              <button className="chip-btn" disabled={e.id === reference?.id} onClick={() => makeReference(e.id)}>
                Als Referenz
              </button>
              <button className="chip-btn" disabled={e.id === reference?.id} onClick={() => makeOverlay(e.id === overlay?.id ? null : e.id)}>
                {e.id === overlay?.id ? "Overlay aus" : "Als Overlay"}
              </button>
              <button className="chip-btn" disabled={e.id === active?.id} onClick={() => switchActive(e.id)}>
                Bearbeiten/Export
              </button>
            </div>
          )}
        </DatasetInfo>
      ))}
      <details className="card collapsible">
        <summary>Standardraum-Vorlage</summary>
        <p className="hint">Vorlage für die räumliche Normalisierung (Registrierung → Standardraum).</p>
        <button
          className="secondary-btn"
          disabled={templateBusy || entries.some((e) => e.dataset.template?.name === BUNDLED_MNI.name)}
          onClick={() => void addBundledTemplate()}
        >
          {templateBusy ? "Wird geladen …" : `${BUNDLED_MNI.name} laden`}
        </button>
        <p className="hint template-attribution">
          {BUNDLED_MNI.attribution}{" "}
          <a href={BUNDLED_MNI.license} target="_blank" rel="noreferrer">
            Lizenz
          </a>
        </p>
        <div className="template-buttons">
          {BUNDLED_PET_TEMPLATES.map((t) => (
            <button
              key={t.id}
              className="secondary-btn"
              title={t.hint}
              disabled={templateBusy || entries.some((e) => e.dataset.template?.name === t.name)}
              onClick={() => void addBundledPetTemplate(t.id)}
            >
              {t.name} laden
            </button>
          ))}
        </div>
        <p className="hint template-attribution">
          {SPM_TEMPLATE_ATTRIBUTION}{" "}
          <a href={SPM_TEMPLATE_LICENSE} target="_blank" rel="noreferrer">
            Lizenz
          </a>
        </p>
        <VolumeUploadPanel single title="Eigene T1-Vorlage (NIfTI)" description="z. B. aus SPM oder CAT12." onLoaded={(l, n) => addOwnTemplate(l, n, "T1")} />
        <label className="field">
          Eigene PET-Vorlage (NIfTI; 4D = adaptive Vorlage: amyloid-negativ, amyloid-positiv)
          <input
            type="file"
            accept=".nii,.gz"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                loadPetTemplate(f)
                  .then((d) => addDataset(d))
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)));
              e.target.value = "";
            }}
          />
        </label>
      </details>
      <details className="card collapsible" open={entries.length === 0 || !!projectionSet}>
        <summary>SPECT-Rohdaten rekonstruieren</summary>
        <UploadPanel onLoaded={handleLoaded} />
        {projectionSet && (
          <ReconControls projectionSet={projectionSet} busy={busy} progress={progress} onStart={handleStart} onCancel={handleCancel} />
        )}
      </details>
      {error && <div className="error-banner">{error}</div>}
    </>
  );

  /** Region list of a label dataset (atlas, CT organs, Centiloid VOIs). */
  const labelList = (e: Entry) => {
    const stats = labelStats(e.dataset.current);
    return (
      <LabelList
        names={e.dataset.atlas!.labels}
        stats={stats}
        visible={e.labelFilter}
        onVisibleChange={(ids) => updateEntry(e.id, { labelFilter: ids })}
        onGoto={(id) => {
          const st = stats.get(id);
          if (!st) return;
          if (e.id !== reference?.id && !overlays.some((o) => o.id === e.id)) makeOverlay(e.id);
          setCursor(applyMat4(e.matrix, st.centroid));
        }}
      />
    );
  };

  const layerSettings = (e: Entry, isOverlay: boolean, index = 0) => {
    const u = unitFor(e);
    return (
      <LayerSettings
        key={e.id}
        title={`${entryLabel(e)}${isOverlay ? ` · Overlay ${overlays.length > 1 ? overlays.length - index : ""}` : overlays.length ? " · Basis" : ""}`}
        display={isOverlay ? e.display : { ...e.display, opacity: 1 }}
        onChange={(d) => updateEntry(e.id, { display: d })}
        scale={u.scale}
        unitLabel={u.label}
        presets={presetsFor(e)}
        showOpacity={isOverlay}
        showVisibility={overlays.length > 0}
      >
        <TagInput value={e.tag ?? ""} onChange={(t) => updateEntry(e.id, { tag: t || undefined })} />
        {e.dataset.atlas && labelList(e)}
        {isOverlay && (
          <div className="chip-row">
            <button className="chip-btn" disabled={index === 0} title="eine Ebene nach oben" onClick={() => moveOverlay(e.id, 1)}>
              ↑ nach oben
            </button>
            <button className="chip-btn" disabled={index === overlays.length - 1} title="eine Ebene nach unten" onClick={() => moveOverlay(e.id, -1)}>
              ↓ nach unten
            </button>
            <button className="chip-btn" onClick={() => makeReference(e.id)}>
              als Basis
            </button>
            <button className="chip-btn" onClick={() => removeOverlay(e.id)}>
              aus Ansicht entfernen
            </button>
          </div>
        )}
      </LayerSettings>
    );
  };

  const overviewVoi = useStableVoi(
    voiMaskData && volume && activeW2v && voi && active
      ? { mask: voiMaskData, volume, w2v: activeW2v, bounds: voiBounds, label: `VOI (${voi.shape.kind === "sphere" ? "Kugel" : voi.shape.kind === "box" ? "Quader" : "gezeichnet"}) auf ${datasetModality(active.dataset)}` }
      : null,
  );
  const overviewRows = useStableRows(
    entries.flatMap((e) => {
      const w2v = w2vById.get(e.id);
      const u = unitFor(e);
      return w2v ? [{ id: e.id, label: entryLabel(e), volume: e.dataset.current, matrix: e.matrix, w2v, scale: u.scale, unitLabel: u.label }] : [];
    }),
  );
  const hiddenEntries = entries.filter((e) => e.id !== reference?.id && !overlays.some((o) => o.id === e.id));
  const visibleStack = [reference, ...overlays].filter((e): e is Entry => !!e && e.display.visible);
  const viewTab = (
    <>
      {[...overlays].reverse().map((o, i) => layerSettings(o, true, i))}
      {reference && layerSettings(reference, false)}
      {hiddenEntries.length > 0 && (
        <section className="card">
          <h3>Weitere Datensätze</h3>
          {hiddenEntries.map((e) => (
            <div key={e.id} className="layer-head">
              <span>{entryLabel(e)}</span>
              <button className="chip-btn" onClick={() => makeOverlay(e.id)}>
                als Overlay einblenden
              </button>
            </div>
          ))}
        </section>
      )}
      {reference && (
        <FusionExportCard
          layerLabels={visibleStack.map((e) => datasetModality(e.dataset))}
          baseLabel={`${reference.dataset.current.nx} × ${reference.dataset.current.ny} × ${reference.dataset.current.nz}`}
          canDicomMeta={reference.dataset.source.kind === "dicom"}
          busy={fusionBusy}
          status={fusionStatus}
          onExport={(f, g, a) => void exportFusion(f, g, a)}
        />
      )}
    </>
  );

  const spaces = entries.flatMap((e) => {
    const w2v = w2vById.get(e.id);
    return w2v ? [{ id: e.id, label: entryLabel(e), dataset: e.dataset, matrix: e.matrix, w2v }] : [];
  });

  const isIdentity = (m: Mat4) => m.every((v, i) => Math.abs(v - IDENTITY_MAT4[i]) < 1e-9);
  const gridInfo = (e: Entry) => {
    const v = e.dataset.current;
    return `${v.nx}×${v.ny}×${v.nz} · ${v.geometry.spacing.map((x) => formatValue(x)).join("×")} mm`;
  };
  const regRows: RegRow[] = movingCandidates.map((e) => {
    const r = coregResults[e.id];
    const status: RegStatusKind =
      regQueue.running === e.id ? "running" : regQueue.waiting.includes(e.id) ? "queued" : r && !r.accepted ? "pending" : r ? "registered" : isIdentity(e.matrix) ? "scanner" : "manual";
    const detail =
      status === "running" && coregProgress
        ? `Stufe ${coregProgress.level}/${coregProgress.levels} · ${similarity(coregSettings.cost === "auto" ? costFor(e) : coregSettings.cost, coregProgress.cost)}`
        : r && (status === "pending" || status === "registered")
          ? `${similarity(r.result.cost, r.result.before)} → ${similarity(r.result.cost, r.result.after)}`
          : undefined;
    return { id: e.id, label: entryLabel(e), info: gridInfo(e), status, detail, passive: isPassive(e) };
  });
  const registrationTab = reference && (
    <>
      <RegistrationSetup
        datasets={entries.map((e) => ({ id: e.id, label: entryLabel(e), info: `${datasetModality(e.dataset)} · ${gridInfo(e)}` }))}
        referenceId={reference.id}
        onReferenceChange={changeBase}
        rows={regRows}
        selected={regSelection}
        onSelectedChange={setRegSelected}
        focusId={moving?.id ?? null}
        onFocus={selectMoving}
        running={coregRunning}
        progressText={
          regQueue.running
            ? `${entryLabel(byId(regQueue.running)!)}${coregProgress ? ` · Stufe ${coregProgress.level}/${coregProgress.levels} · ${coregProgress.stage}` : ""}${regQueue.waiting.length ? ` · noch ${regQueue.waiting.length} wartend` : ""}`
            : null
        }
        onStart={() => void startCoregistration()}
        onCancel={() => {
          regCancelled.current = true;
          coregRun.current?.cancel();
        }}
        onAccept={acceptCoregistration}
        onDiscard={discardCoregistration}
        onAcceptAll={() => setCoregResults((all) => Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { ...v, accepted: true }])))}
        autoCostFor={(id) => (coregSettings.cost === "auto" ? costFor(byId(id)) : coregSettings.cost)}
        error={coregError}
      />
      {moving && movingCenter && (
        <>
          <CoregPanel
            focusLabel={entryLabel(moving)}
            autoCost={autoCost}
            settings={coregSettings}
            onSettingsChange={setCoregSettings}
            running={coregRunning}
            onResetToScanner={() => {
              updateEntry(moving.id, { matrix: IDENTITY_MAT4 });
              discardResultOnly(moving.id);
            }}
            onSaveMatrix={saveMatrix}
            onLoadMatrix={(f) => void loadMatrix(f)}
            frameNote={frameNote}
          />
          <RegistrationPanel
            title={`Manuelle Korrektur: ${entryLabel(moving)} → Basis`}
            params={movingParams}
            onChange={(p) => {
              updateEntry(moving.id, { matrix: matrixFromParams(p, movingCenter) });
              discardResultOnly(moving.id);
            }}
          >
            {!isRigid(movingParams) && (
              <p className="tool-hint">
                Affine Anteile: Skalierung {[movingParams.sx, movingParams.sy, movingParams.sz].map((v) => v.toFixed(3)).join(" / ")}, Scherung{" "}
                {[movingParams.hxy, movingParams.hxz, movingParams.hyz].map((v) => v.toFixed(3)).join(" / ")}
              </p>
            )}
          </RegistrationPanel>
        </>
      )}
    </>
  );

  const normalizationTab = (
    <NormalizationPanel
      templates={templateEntries.map((e) => ({ id: e.id, label: e.dataset.template!.name }))}
      templateId={normTemplate?.id ?? null}
      onTemplateChange={setNormTemplateId}
      bundled={[
        { id: "mni", label: BUNDLED_MNI.name, hint: "T1-MRT-Vorlage (MNI ICBM 2009c)", loaded: entries.some((e) => e.dataset.template?.name === BUNDLED_MNI.name) },
        ...BUNDLED_PET_TEMPLATES.map((t) => ({ id: t.id, label: t.name, hint: t.hint, loaded: entries.some((e) => e.dataset.template?.name === t.name) })),
      ]}
      onLoadBundled={(id) => void (id === "mni" ? addBundledTemplate() : addBundledPetTemplate(id as (typeof BUNDLED_PET_TEMPLATES)[number]["id"]))}
      bundledLoading={templateBusy}
      subjects={subjectCandidates.map((e) => ({ id: e.id, label: entryLabel(e) }))}
      subjectId={normSubject?.id ?? null}
      onSubjectChange={(id) => {
        setNormSubjectId(id);
        setNormSubjectKindOverride(null);
      }}
      subjectKind={subjectKind}
      onSubjectKindChange={setNormSubjectKindOverride}
      method={sameContrast ? normMethod : "affine"}
      onMethodChange={setNormMethod}
      nonlinearAvailable={sameContrast}
      regularization={normRegularization}
      onRegularizationChange={setNormRegularization}
      useMask={normUseMask}
      onUseMaskChange={setNormUseMask}
      maskAvailable={!!normTemplate?.dataset.template?.mask}
      costLabel={normCost === "ncc" ? "Kreuzkorrelation (gleicher Kontrast)" : "Normalisierte Mutual Information (unterschiedlicher Kontrast)"}
      running={normRunning}
      progress={normProgress}
      onStart={startNormalization}
      onCancel={() => normRun.current?.cancel()}
      normalization={normFor}
      transferCandidates={subjectCandidates.map((e) => ({ id: e.id, label: entryLabel(e) }))}
      onTransfer={(ids, method) => normFor && void transferToStandardSpace(normFor, ids, method)}
      transferStatus={transferStatus}
      transferBusy={transferBusy}
      error={normError}
    >
      <DeformationFieldCard
        subjectLabel={normSubject?.dataset.displayName ?? null}
        canExport={!!normFor}
        busy={normRunning || transferBusy}
        onImport={(f) => void importDeformationField(f)}
        onExport={exportDeformationField}
        status={fieldStatus}
      />
      <CentiloidPanel
        voisLoaded={
          centiloidVois
            ? `VOIs geladen (${centiloidVois.resolutionMm} mm): ${Object.keys(centiloidVois.volumes)
                .map((k) => VOI_LABELS[k as VoiName])
                .join(", ")}`
            : null
        }
        onLoadVois={(f) => void loadCentiloidVois(f)}
        onShowVois={showCentiloidVois}
        pets={subjectCandidates.filter((e) => !isAnatomical(unitSource(e.dataset))).map((e) => ({ id: e.id, label: entryLabel(e) }))}
        defaultPetId={subjectCandidates.find((e) => datasetModality(e.dataset) === "PT")?.id ?? null}
        t1s={subjectCandidates.map((e) => ({ id: e.id, label: entryLabel(e) }))}
        defaultT1Id={subjectCandidates.find((e) => datasetModality(e.dataset) === "MR")?.id ?? null}
        petTemplateLabel={templateEntries.find((e) => e.dataset.template?.kind === "PET")?.dataset.template?.name ?? null}
        standardTargets={entries
          .filter((e) => e.dataset.derivedFrom && !e.dataset.derivedFrom.label && !isAnatomical(unitSource(e.dataset)))
          .map((e) => ({ id: e.id, label: entryLabel(e) }))}
        defaultStandardId={entries.findLast((e) => e.dataset.derivedFrom && !e.dataset.derivedFrom.label && !isAnatomical(unitSource(e.dataset)))?.id ?? null}
        running={centiloidRunning}
        status={centiloidStatus ? `${centiloidStatus}${normProgress && centiloidRunning ? ` (${normProgress.stage} · ${normProgress.detail})` : ""}` : null}
        onRun={(p, t, c) => void runCentiloidPipeline(p, t, c)}
        onEvaluate={evaluateExisting}
        onCancel={() => {
          centiloidCancelled.current = true;
          normRun.current?.cancel();
        }}
        outcome={centiloidOutcome}
        error={centiloidError}
      />
      <AtlasPanel
        atlases={entries.filter((e) => e.dataset.atlas).map((e) => ({ id: e.id, label: e.tag ? `${e.tag} – ${e.dataset.atlas!.name}` : e.dataset.atlas!.name, atlas: e.dataset.atlas! }))}
        onLoadBundled={() => void addBundledAtlas()}
        bundledLoading={atlasBusy}
        onLoadOwn={(f) => void addOwnAtlas(f)}
        targets={entries.filter((e) => !e.dataset.template && !e.dataset.atlas).map((e) => ({ id: e.id, label: entryLabel(e) }))}
        defaultTargetId={entries.findLast((e) => e.dataset.derivedFrom && !e.dataset.derivedFrom.label && !isAnatomical(unitSource(e.dataset)))?.id ?? null}
        compute={computeRegions}
        onCreateSuvrImage={createSuvrImage}
        error={atlasError}
      />
    </NormalizationPanel>
  );

  const tabs: ShellTab[] = [
    { id: "data", label: "Daten", icon: FolderOpen, content: dataTab, badge: entries.length > 1 ? entries.length : undefined },
    { id: "view", label: "Ansicht", icon: Eye, disabled: layers.length === 0, content: viewTab },
    { id: "registration", label: "Registrierung", shortLabel: "Registr.", icon: Crosshair, disabled: entries.length < 2, content: registrationTab },
    { id: "normalization", label: "Standardraum", shortLabel: "MNI", icon: Brain, disabled: entries.filter((e) => !e.dataset.template).length === 0, content: normalizationTab },
    {
      id: "tumor",
      label: "Tumorlast",
      shortLabel: "Tumor",
      icon: Target,
      disabled: tumorTargets.length === 0 && ctEntries.length === 0,
      content: (
        <>
        <CtSegCard
          cts={ctEntries.map((e) => ({ id: e.id, label: entryLabel(e) }))}
          defaultCtId={ctEntries[0]?.id ?? null}
          running={ctSegRunning}
          progress={ctSegProgress}
          status={ctSegStatus}
          error={ctSegError}
          webgpu={webgpuAvailable}
          onRun={startCtSegmentation}
          onCancel={() => ctSegRun.current?.cancel()}
        />
        {organEntry?.dataset.atlas && (
          <section className="card">
            <h3>Regionen · {entryLabel(organEntry)}</h3>
            <p className="tool-hint">Klick auf eine Region setzt das Fadenkreuz hinein; Häkchen blenden Regionen im Bild ein oder aus.</p>
            {labelList(organEntry)}
          </section>
        )}
        <TumorPanel
          targets={tumorTargets.map((e) => ({ id: e.id, label: entryLabel(e) }))}
          targetId={tumorEntry?.id ?? null}
          onTargetChange={setTumorTargetId}
          unitInfo={tumorSuv?.ok ? "Schwellen in SUV (Körpergewicht) aus dem DICOM-Header." : `Kein SUV verfügbar${tumorSuv && !tumorSuv.ok ? ` (${tumorSuv.reason})` : ""} – die Werte werden direkt als SUV interpretiert.`}
          suvAvailable={!!tumorSuv?.ok}
          liver={liverRef && liverRef.entryId === tumorEntry?.id ? liverRef : null}
          voiAvailable={!!overviewVoi}
          onLiverFromVoi={liverFromVoi}
          busy={tumorBusy}
          error={tumorError}
          onRun={(m, ml) => void runTumor(m, ml)}
          description={tumor?.description ?? null}
          burden={tumor ? tumorBurden(tumor.lesions) : null}
          lesions={tumor?.lesions ?? []}
          mode={tumorMode}
          onModeChange={setTumorMode}
          brushMm={tumorBrushMm}
          onBrushMmChange={setTumorBrushMm}
          onToggle={toggleLesion}
          onGoto={gotoLesion}
          onExportCsv={exportTumorCsv}
          onExportNifti={exportTumorNifti}
          onClear={() => setTumor(null)}
          indication={tumorIndication}
          onIndicationChange={setTumorIndication}
          organOptions={organEntries.map((e) => ({ id: e.id, label: entryLabel(e) }))}
          organId={organEntry?.id ?? null}
          onOrganChange={(id) => setTumorOrganId(id)}
          autoExclude={tumorAutoExclude}
          onAutoExcludeChange={setTumorAutoExclude}
          canAutoLiver={!!organEntry?.dataset.atlas && [...organEntry.dataset.atlas.labels.values()].some((n) => n.replace(/ /g, "_") === "liver")}
          onAutoLiver={autoLiver}
          split={tumor && tumorIndication === "psma" && organEntry ? splitBurden(tumor.lesions) : null}
        />
        </>
      ),
    },
    {
      id: "analysis",
      label: "Analyse",
      icon: BarChart3,
      disabled: !stats,
      content: volume && stats && active && (
        <>
          <DatasetOverview
            rows={overviewRows}
            selectedId={active.id}
            onSelect={switchActive}
            voi={overviewVoi}
          />
          <LabelAnalysis
            labelSets={entries.filter((e) => e.dataset.atlas).map((e) => ({ id: e.id, label: entryLabel(e), atlas: e.dataset.atlas! }))}
            defaultLabelSetId={entries.findLast((e) => e.dataset.atlas)?.id ?? null}
            targets={entries.filter((e) => !e.dataset.atlas).map((e) => ({ id: e.id, label: entryLabel(e) }))}
            defaultTargetId={active.dataset.atlas ? null : active.id}
            compute={computeLabelAnalysis}
            onLoadCerebra={() => void addBundledAtlas()}
            cerebraLoading={atlasBusy}
            onLoadOwn={(f) => void addOwnAtlas(f)}
            loadError={atlasError}
            onAssignNames={(id, src) => void assignAtlasNames(id, src)}
          />
          <section className="card">
            <h3>Detailanalyse: {entryLabel(active)}</h3>
            <AnalysisPanel
              volume={volume}
              stats={stats}
              marker={parseInput(threshold) / scale}
              scale={scale}
              unitLabel={unitLabel}
              unitMode={unitMode}
              suv={activeSuv}
              onUnitModeChange={handleUnitModeChange}
            />
          </section>
        </>
      ),
    },
    {
      id: "edit",
      label: "Bearbeiten",
      icon: Wand2,
      disabled: !stats,
      badge: dataset?.edits.length,
      content: dataset && volume && stats && (
        <>
          <ValueSection
            volume={volume}
            stats={stats}
            scale={scale}
            unitLabel={unitLabel}
            threshold={threshold}
            onThresholdChange={setThreshold}
            value={newValue}
            onValueChange={setNewValue}
            busy={editBusy}
            onApply={handleApplyEdit}
          />
          <VoiSection
            scale={scale}
            unitLabel={unitLabel}
            tool={voiTool}
            onToolChange={(t) => {
              setVoiTool(t);
              if (t !== "brush") setBrush((b) => ({ ...b, active: false }));
            }}
            sphereRadius={sphereRadius}
            onSphereRadiusChange={setSphereRadius}
            boxSize={boxSize}
            onBoxSizeChange={setBoxSize}
            brush={brush}
            onBrushChange={setBrush}
            onPlace={placeVoi}
            onClear={() => setVoi(null)}
            hasVoi={!!voiMaskData}
            stats={voiStatistics && voiStatistics.voxels > 0 ? voiStatistics : null}
            totalVoxels={stats.count}
            countFor={countVoi}
            busy={editBusy}
            onApply={(region, action) => {
              const shape = voiForEdit();
              if (shape) handleApplyEdit({ type: "voi", voi: shape, region, action });
            }}
            onCrop={() => voiBounds && handleApplyEdit({ type: "crop", min: voiBounds.min, max: voiBounds.max })}
          />
          <FilterSection busy={editBusy} onApply={handleApplyEdit} />
          <GeometrySection key={`${volume.nx}x${volume.ny}x${volume.nz}`} volume={volume} busy={editBusy} onApply={handleApplyEdit} />
          <HistorySection scale={scale} unitLabel={unitLabel} edits={dataset.edits} busy={editBusy} onUndo={handleUndo} onReset={handleReset} />
          {error && <div className="error-banner">{error}</div>}
        </>
      ),
    },
    {
      id: "header",
      label: "Header",
      icon: FileCode2,
      wide: true,
      disabled: dataset?.source.kind !== "dicom",
      badge: dataset?.headerEdits.length,
      content: dataset && active && (
        <HeaderPanel key={active.id} dataset={dataset} onEditsChange={(headerEdits) => setDataset(active.id, { ...dataset, headerEdits })} />
      ),
    },
    {
      id: "export",
      label: "Export",
      icon: Download,
      disabled: !dataset,
      content: dataset && active && <ExportPanel dataset={dataset} spaces={spaces} activeId={active.id} />,
    },
  ];

  const displayedIds = layers.map((l) => l.id);
  const mipLayerId = [overlay, reference].find((e) => e && !isAnatomical(e.dataset.source))?.id ?? reference?.id;

  return (
    <AppShell
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      panelOpen={panelOpen}
      onPanelOpenChange={setPanelOpen}
      theme={theme}
      onThemeChange={setTheme}
      headerInfo={entries.map((e) => (
        <button
          key={e.id}
          className={`dataset-chip clickable${e.id === active?.id && entries.length > 1 ? " active" : ""}`}
          title={`${e.dataset.displayName}${entries.length > 1 ? " – klicken, um Analyse, Bearbeitung, Header und Export auf diesen Datensatz anzuwenden" : ""}`}
          onClick={() => switchActive(e.id)}
        >
          <span className="badge">{datasetModality(e.dataset)}</span>
          {e.tag && <span className="chip-tag">{e.tag}</span>}
          <span className="chip-name">{e.dataset.displayName}</span>
          {e.id === reference?.id && entries.length > 1 && <span className="chip-edited chip-ref">Ref</span>}
          {e.dataset.edits.length > 0 && <span className="chip-edited">bearbeitet</span>}
        </button>
      ))}
    >
      {layers.length > 0 ? (
        <Viewer
          layers={layers}
          activeLayerId={active && displayedIds.includes(active.id) ? active.id : (reference?.id ?? "")}
          mipLayerId={mipLayerId}
          paintMode={(brush.active && voiTool === "brush" && activeTab === "edit" && panelOpen) || (activeTab === "tumor" && panelOpen && !!tumor && (tumorMode === "add" || tumorMode === "erase"))}
          onPaint={activeTab === "tumor" ? tumorPaint : paint}
          cursor={cursor}
          onCursorChange={(p) => {
            if (activeTab === "tumor" && panelOpen && tumorMode === "pick" && tumor) tumorClick(p);
            setCursor(p);
          }}
          onWindowChange={(id, window) => {
            const e = byId(id);
            if (e) updateEntry(id, { display: { ...e.display, window } });
          }}
          layout={layout}
          focusView={focusView}
          onLayoutChange={(l, f) => {
            setLayout(l);
            setFocusView(f);
          }}
          toolbar={
            entries.length > 1 &&
            active && (
              <span className="toolbar-note">
                Aktiv: <strong>{datasetModality(active.dataset)}</strong>
              </span>
            )
          }
        />
      ) : (
        <div className="welcome">
          <div className="welcome-card">
            <h2>Willkommen in Recon Studio</h2>
            <p>
              {projectionSet
                ? "Rohdaten geladen – im Panel „Daten“ die Rekonstruktion starten."
                : "PET-, SPECT-, CT- oder MRT-Daten als DICOM (einzeln oder als Serie) bzw. NIfTI laden, SPECT-Rohdaten rekonstruieren, analysieren, bearbeiten, coregistrieren und exportieren."}
            </p>
            {!projectionSet && (
              <button
                className="primary-btn"
                onClick={() => {
                  setActiveTab("data");
                  setPanelOpen(true);
                }}
              >
                Daten laden
              </button>
            )}
            <p className="welcome-note">Alle Daten werden ausschließlich lokal im Browser verarbeitet.</p>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default App;
