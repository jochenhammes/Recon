import { useEffect, useMemo, useRef, useState } from "react";
import { sanitizePatientId, setExportPatientId, umlaut, withPatientId } from "./core/exportName";
import { Card } from "./ui/Card";
import { Activity, BarChart3, Brain, Calculator, Crosshair, Download, Eye, FileCode2, FolderOpen, Gauge, Radiation, Save, Target, Wand2 } from "lucide-react";
import { ManualOverlay } from "./ui/ManualOverlay";
import { acquisitionMs } from "./dosimetry/sessions";
import { type DosimetryApi, DosimetryPanel } from "./dosimetry/DosimetryPanel";
import { type DosimetrySetup, emptySetup } from "./dosimetry/setup";
import { KineticsPanel, type KineticsApi } from "./kinetics/KineticsPanel";
import { LayerToggle } from "./ui/LayerToggle";
import { editedHalfLife } from "./header/radionuclide";
import { type TripleWindowRequest, TripleWindowCard } from "./ui/TripleWindowCard";
import { regionTable, smoothTripleWindow } from "./edit/tripleWindow";
import { gaussianSmooth } from "./edit/filters";
import { GlRenderer } from "./viewer/gl/renderer";
import { type ImcalcJob, ImcalcPanel } from "./ui/ImcalcPanel";
import { combine, groupMeanSd, linear, product, quotient, zScore } from "./imcalc/imcalc";
import { PROJECT_EXTENSION, ProjectError, loadProject, saveProject } from "./project/project";
import { InfoText } from "./ui/Info";
import { type DisplayCandidate, type DisplayDecision, boxOverlap, decideDisplay, gridBox, gridKey } from "./dataset/autoDisplay";
import { type Activity as JobActivity, ActivityBar } from "./ui/ActivityBar";
import { FrameSlider } from "./ui/FrameSlider";
import { runKineticsJob } from "./kinetics/runner";
import type { FrameMotion } from "./kinetics/motion";
import { meanOfFrames } from "./viewer/volumeLoader";
import { NormalizationPanel, type NormMethod, type Regularization } from "./ui/NormalizationPanel";
import { type Normalization, REGULARIZATION_WEIGHT, sameGrid, describeCoregProgress, describeWarpProgress, fieldFromAffine, pullbackPositions, resampleField } from "./normalization/model";
import { DEFAULT_WARP } from "./normalization/warp";
import { buildDeformationField, fieldCoverage, parseDeformationField } from "./normalization/yfield";
import { DeformationFieldCard } from "./ui/DeformationFieldCard";
import { CentiloidPanel, type CentiloidOutcome } from "./ui/CentiloidPanel";
import { TagInput } from "./ui/TagInput";
import { LabelList } from "./ui/LabelList";
import { filteredLabels, labelStats, majorityLabels, subVoxelOffsets } from "./atlas/labelStats";
import { TumorPanel, type TumorIndication, type TumorMode } from "./ui/TumorPanel";
import { CtSegCard } from "./ui/CtSegCard";
import { type SegBenchmarkResult, SegBenchmarkCard } from "./ui/SegBenchmarkCard";
import { compareLabelMaps } from "./segmentation/metrics";
import { canonicalName } from "./segmentation/labelMap";
import type { SegmentProgress } from "./segmentation/infer";
import { CT_MODELS, type CtModelInfo, type CtSegResult, type CtSegRun, DEFAULT_CT_MODEL, loadModelMeta, runCtSegmentation } from "./segmentation/ctSegment";
import type { CtSegBackend } from "./workers/ctseg.worker";
import { type Lesion, type ThresholdMethod, cleanupLesions, growLesion, lesionStats } from "./tumor/segment";
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
import { atlasFromLabels, parseFslAtlasXml, parseLabelTable, pickAtlasEntries, regionStats } from "./atlas/atlas";
import { BUNDLED, bundledEntry, defaultTemplateId, identifyUserFiles } from "./brain/catalog";
import { loadBundledEntry } from "./brain/load";
import { cacheUserFiles, cachedEntryIds, cachedUserFiles, removeCachedEntry } from "./brain/userCache";
import { BrainCatalog } from "./ui/BrainCatalog";
import { LangToggle } from "./ui/LangToggle";
import { tx, useLang, tBoth } from "./i18n";
import { parseXmlLabelTable } from "./atlas/labelNifti";
import { LabelAnalysis, type LabelAnalysisResult } from "./ui/LabelAnalysis";
import { listZip } from "./core/unzip";
import { runWarp } from "./normalization/warpRunner";
import { runResample } from "./resample/runner";
import { type Interpolation, resampleAtPoints, resampleInto } from "./resample/resample";
import { CoregSettingsForm, type CoregSettings } from "./ui/CoregPanel";
import { AlignCard, type AlignTab } from "./ui/AlignCard";
import { similarity } from "./registration/similarity";
import { type RegistrationRun, runCoregistration } from "./registration/runner";
import type { CoregProgress, CoregResult } from "./registration/coregister";
import { HeaderPanel } from "./ui/HeaderPanel";
import { AppShell, type ShellTab } from "./ui/AppShell";
import { DatasetDetails } from "./ui/DatasetInfo";
import { DatasetList } from "./ui/DatasetList";
import { LayerSettings, type WindowPreset } from "./ui/ViewSettingsPanel";
import { type RegRow, type RegStatusKind, RegistrationSetup } from "./ui/RegistrationSetup";
import { shortLabel } from "./core/shortLabel";
import { RegistrationPanel } from "./ui/RegistrationPanel";
import { CT_PRESETS, acquisitionTime, datasetModality, formatAcquisitionTime, defaultDisplay, isAnatomical, middleEllipsis, modalityLabel, rawUnitLabel, shortName, suvForSource, unitSource } from "./dataset/describe";
import { BUNDLED_PET_TEMPLATES, type TemplateKind, coarseTemplate, loadBundledMni, loadBundledPetTemplate, loadPetTemplate } from "./normalization/templates";
import { tracerHint } from "./brain/tracer";
import { AnalysisPanel } from "./components/AnalysisPanel";
import { type BrushState, FilterSection, type GeometryAction, GeometrySection, type GeometryTarget, HistorySection, ValueSection, VoiSection, type VoiTool } from "./components/EditTools";
import { type GroupTarget, groupEditFor, referenceCenter, rotationSense } from "./edit/groupGeometry";
import { LANDMARK_1, LANDMARK_2, type Landmark, alignByLandmark, alignTwoLandmarks, originShift, reorientPlan } from "./registration/landmarks";
import { worldToPlane } from "./viewer/planes";
import { LandmarkPanel, type LandmarkSide } from "./ui/LandmarkCard";
import { runEdits } from "./edit/runner";
import { type VoiShape, maskBounds, paintDisc, voiMask, voiStats } from "./edit/voi";
import { computeStats } from "./analysis/stats";
import type { SuvResult } from "./analysis/suv";
import { type UnitMode, fmtFixed, formatInput, formatValue, parseInput } from "./components/format";
import { type LoadedDataset, type VolumeSource, createDataset } from "./dataset/types";
import { type EditOp, type VoiAction, changesGrid, countAffected, describeEdit } from "./edit/operations";
import { type LoadedVolume, decompressGzip, loadVolumeFromFiles } from "./viewer/volumeLoader";
import { UploadPanel } from "./components/UploadPanel";
import { VolumeUploadPanel } from "./components/VolumeUploadPanel";
import { ReconControls } from "./components/ReconControls";
import { ExportPanel } from "./components/ExportPanel";
import { buildSinogram } from "./recon/sinogram";
import type { ReconParams } from "./recon/volume";
import { reconstructVolume } from "./workers/workerPool";
import { type ColorLut, Volume3D, migrateLut } from "./viewer/volume";
import { Viewer, type ViewerProps } from "./viewer/Viewer";
import { autoMipId } from "./viewer/mipChoice";
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
  transformGeometry,
  paramsFromMatrix,
  parseTransformFile,
  transformedWorldToVoxel,
} from "./core/transform";
import type { SpectProjectionSet } from "./dicom/types";
import "./App.css";

import { T } from "./i18n/T";
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
  /** Anatomical landmarks in the dataset's own (native) coordinates. */
  landmarks?: Landmark[];
  /** Label images: labels shown in the viewer (undefined = all). */
  labelFilter?: number[];
  /** Dynamic datasets: frame shown in the viewer (undefined = time-weighted mean). */
  frame?: number;
  /** Dynamic datasets: window follows each frame. */
  frameAutoWindow?: boolean;
}

/** Volume of one frame of a dynamic dataset (cached per frame array, so the GPU upload happens once). */
const frameVolumes = new WeakMap<Float32Array, Volume3D>();
function frameVolume(e: Entry): Volume3D {
  const dyn = e.dataset.dynamic;
  const f = e.frame;
  if (!dyn || f === undefined || !dyn.frames[f]) return e.dataset.current;
  const data = dyn.frames[f];
  let v = frameVolumes.get(data);
  if (!v || v.nx !== e.dataset.current.nx) frameVolumes.set(data, (v = e.dataset.current.withData(data)));
  return v;
}

/** 0 … 99.5th percentile of a frame (sampled), for the per-frame window. */
function frameWindow(data: Float32Array): [number, number] {
  const step = Math.max(1, Math.floor(data.length / 200000));
  const s: number[] = [];
  for (let i = 0; i < data.length; i += step) if (data[i] > 0) s.push(data[i]);
  if (!s.length) return [0, 1];
  s.sort((a, b) => a - b);
  return [0, s[Math.floor(0.995 * (s.length - 1))] || 1];
}

/** Name of a dataset in lists and selections: tag (if any), modality, file/series name. */
/** Datasets transferred into a standard space are named after their source plus " · MNI". */
function spaceSuffix(e: Entry): string {
  const d = e.dataset.derivedFrom;
  return d && !d.label ? " · MNI" : "";
}
function baseName(e: Entry): string {
  const d = e.dataset.derivedFrom;
  return shortName(d && !d.label ? d.name : e.dataset.displayName);
}

function entryLabel(e: Entry): string {
  const base = `${datasetModality(e.dataset)} · ${baseName(e)}${spaceSuffix(e)}`;
  return e.tag ? `${e.tag} – ${base}` : base;
}

/** Short name for the status bar and the layer overlay: modality and tag, else modality and shortened file name. */
function entryShort(e: Entry, max = 22): string {
  return `${datasetModality(e.dataset)} · ${e.tag || middleEllipsis(baseName(e), max)}${spaceSuffix(e)}`;
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
  return { ...d, lut: d.lut === "gray" ? "hot" : d.lut, opacity: d.opacity === 1 ? 0.6 : d.opacity, visible: true };
}

const UNIT_PREF_KEY = "recon-studio-unit-mode";
/** Value display chosen in the viewer (SUV or raw), remembered in the browser. */
function readUnitPreference(): UnitMode | null {
  try {
    const v = localStorage.getItem(UNIT_PREF_KEY);
    return v === "suv" || v === "raw" ? v : null;
  } catch {
    return null;
  }
}
function writeUnitPreference(mode: UnitMode) {
  try {
    localStorage.setItem(UNIT_PREF_KEY, mode);
  } catch {
    /* not remembered */
  }
}

function App() {
  // Re-render the whole app when the language changes (all texts go through t()).
  useLang();
  const [projectionSet, setProjectionSet] = useState<SpectProjectionSet | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  /** Overlays drawn on top of the reference, bottom first. */
  const [overlayIds, setOverlayIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [threshold, setThreshold] = useState("");
  const [newValue, setNewValue] = useState("0");
  const [unitMode, setUnitMode] = useState<UnitMode>(() => readUnitPreference() ?? "raw");
  /** The user chose the value display (SUV / raw) in the viewer: loading data no longer switches it. */
  const unitChosen = useRef<boolean>(readUnitPreference() !== null);
  const [cursor, setCursor] = useState<Vec3 | null>(null);
  /** MIP: dataset, color table and an own window (null = like the dataset), independent of the slice views. */
  const [mipChoice, setMipChoice] = useState<{ id: string | null; lut: ColorLut | null; window?: [number, number] | null }>({ id: null, lut: null });
  const [landmarkMode, setLandmarkMode] = useState(false);
  const [landmarkView, setLandmarkView] = useState<LandmarkSide>("base");
  /** Open tab of the "Ausrichten" card and the last landmark step, per target dataset. */
  const [alignTabFor, setAlignTabFor] = useState<{ id: string; tab: AlignTab } | null>(null);
  const [landmarkStepFor, setLandmarkStepFor] = useState<{ id: string; step: 0 | 1 | 2 } | null>(null);
  const [rotPivot, setRotPivot] = useState<"landmark" | "center">("landmark");
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
  /** Output grid of the normalization: the template grid, or MNI 2009c 1 mm. */
  const [normOutput, setNormOutput] = useState<"template" | "1mm">("template");
  const [normSubjectKindOverride, setNormSubjectKindOverride] = useState<TemplateKind | null>(null);
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
  /** Tumor burden result; `datasetId` is the label dataset "Läsionen · …" that mirrors the included lesions. */
  const [tumor, setTumor] = useState<{ entryId: string; labels: Int32Array; lesions: Lesion[]; description: string; version: number; datasetId?: string } | null>(null);
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
  const [benchRunning, setBenchRunning] = useState(false);
  const [benchProgress, setBenchProgress] = useState<string | null>(null);
  const [benchResults, setBenchResults] = useState<SegBenchmarkResult[]>([]);
  const [benchInfo, setBenchInfo] = useState<{ ct: string; reference: string | null } | null>(null);
  const benchCancel = useRef(false);
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
  const [loadBusy, setLoadBusy] = useState(false);
  const [exportActivity, setExportActivity] = useState<string | null>(null);
  /** Patient ID: prefix of all exported NIfTI/CSV file names. */
  const [patientId, setPatientId] = useState("");
  setExportPatientId(patientId);
  const [kineticsActivity, setKineticsActivity] = useState<{ label: string; fraction: number | null } | null>(null);
  const [dosimetry, setDosimetry] = useState<DosimetrySetup>(() => emptySetup());
  const [dosimetryActivity, setDosimetryActivity] = useState<string | null>(null);
  /**
   * Acquisition time per dataset for chronological lists: from its own header, else from a dataset of the same
   * acquisition (frame of reference) or the dataset it was derived from by name (organ map, lesions, dose map).
   */
  const timeKey = entries.map((e) => `${e.id}:${e.dataset.displayName}:${e.dataset.current.geometry.frameOfReferenceUid ?? ""}`).join("|");
  const entryTimes = useMemo(() => {
    const own = new Map(entries.map((e) => [e.id, acquisitionMs(e.dataset)] as const));
    const out = new Map<string, number>();
    for (const e of entries) {
      let t = own.get(e.id);
      const fo = e.dataset.current.geometry.frameOfReferenceUid;
      if (t === undefined && fo) {
        const same = entries.filter((x) => x.dataset.current.geometry.frameOfReferenceUid === fo).map((x) => own.get(x.id)).filter((x): x is number => x !== undefined);
        if (same.length) t = Math.min(...same);
      }
      if (t === undefined) {
        const parent = entries.find((x) => x.id !== e.id && own.get(x.id) !== undefined && e.dataset.displayName.endsWith(`· ${x.dataset.displayName}`));
        if (parent) t = own.get(parent.id);
      }
      if (t !== undefined) out.set(e.id, t);
    }
    return out;
  }, [timeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Manual shown over the viewer ("?" in the header). */
  const [manualOpen, setManualOpen] = useState(false);
  const closeManual = useMemo(() => () => setManualOpen(false), []);

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
  const sourceKey = entries.map((e) => `${e.id}:${editedHalfLife(e.dataset.headerEdits) ?? ""}`).join("|");
  const suvById = useMemo(() => {
    const m = new Map<string, SuvResult | null>();
    // A radionuclide changed in the header editor applies to the SUV right away (half-life for the decay correction).
    for (const e of entries) m.set(e.id, suvForSource(unitSource(e.dataset), { halfLifeSec: editedHalfLife(e.dataset.derivedFrom ? undefined : e.dataset.headerEdits) }));
    return m;
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const unitFor = (e: Entry | undefined) => {
    if (!e) return { scale: 1, label: "" };
    const suv = suvById.get(e.id);
    if (unitMode === "suv" && suv?.ok) return { scale: suv.info.factor, label: "SUV" };
    return { scale: 1, label: e.dataset.valueUnit ?? rawUnitLabel(unitSource(e.dataset)) };
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

  // ── Viewer layers: reference at the bottom, overlay on top, VOI above. ──
  const layerUnits = new Map(entries.map((e) => [e.id, unitFor(e)]));
  const unitsKey = [...layerUnits.values()].map((u) => `${u.scale}:${u.label}`).join("|");
  const layers = useMemo<ViewerLayer[]>(() => {
    const out: ViewerLayer[] = [];
    const add = (e: Entry | undefined, display?: LayerDisplay) => {
      const w2v = e && w2vById.get(e.id);
      if (!e || !w2v) return;
      const volume = e.dataset.atlas && e.labelFilter ? filteredLabels(e.dataset.current, e.labelFilter) : frameVolume(e);
      out.push({ id: e.id, label: entryShort(e), title: entryLabel(e), labelNames: e.dataset.atlas?.labels, volume, w2v, display: display ?? e.display, unit: layerUnits.get(e.id) });
    };
    add(reference, reference ? { ...reference.display, opacity: 1 } : undefined);
    for (const o of overlays) add(o);
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
  }, [reference, overlays, w2vById, unitsKey, voiMaskData, volume, activeW2v, voi]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const live = useRef<{ entries: Entry[]; referenceId: string | null; activeId: string | null; overlayIds: string[] }>({ entries, referenceId: reference?.id ?? null, activeId: active?.id ?? null, overlayIds });
  live.current = { entries, referenceId: reference?.id ?? null, activeId: active?.id ?? null, overlayIds };

  /** Loading decisions of the current upload (for the notice after loading). */
  const loadDecisions = useRef<{ name: string; shown: boolean }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(t);
  }, [notice]);

  /** Display decision for a newly loaded dataset (see decideDisplay). */
  function autoDecision(next: LoadedDataset): DisplayDecision {
    const L = live.current;
    const cand = (d: LoadedDataset): DisplayCandidate => {
      const v = d.current;
      const dims: [number, number, number] = [v.nx, v.ny, v.nz];
      return {
        anatomical: isAnatomical(d.source) || d.template?.kind === "T1",
        ct: !d.template && !d.atlas && modalityLabel(d.source) === "CT",
        labels: !!d.atlas,
        box: gridBox(v.geometry, dims),
        gridKey: gridKey(v.geometry, dims),
        frameOfReference: d.source.kind === "dicom" ? d.source.files[0].dataSet.string("x00200052")?.trim() || undefined : undefined,
      };
    };
    const ref = L.entries.find((e) => e.id === L.referenceId);
    const shown = L.overlayIds.flatMap((id) => {
      const e = L.entries.find((x) => x.id === id);
      return e && e.display.visible && id !== L.referenceId ? [cand(e.dataset)] : [];
    });
    return decideDisplay(cand(next), ref ? cand(ref.dataset) : null, shown);
  }

  /**
   * Adds a dataset. Without `decision`: the first dataset becomes the base, a CT/MR replaces a functional base,
   * everything else is shown on top (used for derived datasets). Loaded files pass the decision of `autoDecision`.
   */
  function addDataset(next: LoadedDataset, decision?: DisplayDecision): Entry {
    const L = live.current;
    const entry: Entry = { id: `ds${nextEntryId++}`, dataset: next, display: defaultDisplay(next.current, next.source), matrix: IDENTITY_MAT4 };
    if (next.atlas) entry.display = { window: [0, 255], lut: "labels", opacity: 0.45, visible: true, nearest: true };
    const ref = L.entries.find((e) => e.id === L.referenceId);
    const act = L.entries.find((e) => e.id === L.activeId);
    if (((next.template || next.atlas) && ref && !decision) || (decision === "hidden" && ref)) {
      // Templates, atlases and datasets not displayed automatically are added without changing reference, overlay or
      // active dataset (they can be shown via "Ebenen").
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
    } else if (decision ? decision === "newBase" : anatomical && !isAnatomical(ref.dataset.source)) {
      // CT/MR becomes the display base; the previous reference is shown on top.
      list = list.map((e) => (e.id === ref.id ? { ...e, display: overlayDisplay(e) } : e));
      referenceId = entry.id;
      setReferenceId(entry.id);
      addOverlay(ref.id);
    } else {
      list = list.map((e) => (e.id === entry.id ? { ...e, display: overlayDisplay(e) } : e));
      addOverlay(entry.id);
      L.overlayIds = [...L.overlayIds, entry.id];
    }
    setEntries(list);
    setCursor(null);
    // A CT/MR added for fusion does not take over analysis/editing from an existing PET/SPECT.
    const becomesActive = !next.atlas && (!act || !anatomical || isAnatomical(act.dataset.source));
    let activeId = L.activeId;
    if (becomesActive) {
      activeId = entry.id;
      setActiveId(entry.id);
      setVoi(null);
      const suv = suvForSource(next.source);
      if (!anatomical) setUnitMode(unitChosen.current ? (readUnitPreference() ?? "raw") : suv?.ok ? "suv" : "raw");
      resetEditInputs(next, !anatomical && suv?.ok ? suv.info.factor : 1);
    }
    live.current = { entries: list, referenceId, activeId, overlayIds: L.overlayIds };
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
    if (tumor && (tumor.datasetId === id || tumor.entryId === id)) {
      setTumor(null);
      if (tumor.entryId === id && tumor.datasetId) {
        setEntries((prev) => prev.filter((x) => x.id !== tumor.datasetId));
        removeOverlay(tumor.datasetId);
      }
    }
  }

  // ── Project file (.recon): whole session ──
  const [projectBusy, setProjectBusy] = useState<"save" | "open" | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const projectInput = useRef<HTMLInputElement>(null);

  function sessionState() {
    return {
      patientId,
      // Unchanged bundled templates/atlases are stored by catalogue id only and fetched again on opening.
      entries: entries.map((e) =>
        e.dataset.catalogId && bundledEntry(e.dataset.catalogId) && !e.dataset.edits.length && e.dataset.current === e.dataset.original
          ? { ...e, dataset: { catalogRef: e.dataset.catalogId, displayName: e.dataset.displayName } as unknown as LoadedDataset }
          : e,
      ),
      referenceId,
      overlayIds,
      activeId,
      layout,
      focusView,
      cursor,
      unitMode,
      normalization,
      normSubjectId,
      normTemplateId,
      centiloidVois,
      centiloidOutcome,
      tumor,
      tumorIndication,
      tumorTargetId,
      liverRef,
      dosimetry,
      mipChoice,
    };
  }

  async function saveProjectFile() {
    if (!entries.length || projectBusy) return;
    setProjectBusy("save");
    setProjectError(null);
    await new Promise((r) => setTimeout(r, 30)); // let the activity indicator render
    try {
      const blob = saveProject(sessionState(), { app: "Recon Studio", datasets: entries.map((e) => entryLabel(e)) });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = withPatientId(tx("Recon-Projekt_{v}{PROJECT_EXTENSION}", { v: new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-"), PROJECT_EXTENSION }), { project: true });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice(tx("Projekt gespeichert ({v} MB).", { v: (blob.size / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 1 }) }));
    } catch (e) {
      setProjectError(tx("Speichern fehlgeschlagen: {v}", { v: e instanceof Error ? e.message : String(e) }));
    } finally {
      setProjectBusy(null);
    }
  }

  async function openProjectFile(file: File) {
    if (projectBusy) return;
    if (entries.length && !window.confirm(tx("Projekt öffnen: Die aktuell geladenen Datensätze und Ergebnisse werden ersetzt. Fortfahren?"))) return;
    setProjectBusy("open");
    setProjectError(null);
    try {
      const { state, meta } = await loadProject(await file.arrayBuffer());
      const st = state as ReturnType<typeof sessionState>;
      if (!Array.isArray(st.entries)) throw new Error(tx("Projekt enthält keine Datensätze."));
      // Bundled templates/atlases saved by reference: load them from the app again.
      st.entries = await Promise.all(
        st.entries.map(async (e) => {
          const ref = (e.dataset as unknown as { catalogRef?: string }).catalogRef;
          if (!ref) return e;
          const b = bundledEntry(ref);
          if (!b) throw new Error(tx("Vorlage/Atlas „{ref}“ ist in dieser Version der App nicht enthalten.", { ref }));
          return { ...e, dataset: { ...(await loadBundledEntry(b)), displayName: e.dataset.displayName } };
        }),
      );
      const savedVersion = typeof meta.version === "number" ? meta.version : 1;
      st.entries = st.entries.map((e) => ({ ...e, display: { ...e.display, lut: migrateLut(e.display.lut, savedVersion) } }));
      for (const e of st.entries) {
        const n = Number(e.id.replace(/^ds/, ""));
        if (Number.isFinite(n) && n >= nextEntryId) nextEntryId = n + 1;
      }
      setEntries(st.entries);
      setPatientId(st.patientId ?? "");
      setReferenceId(st.referenceId);
      setOverlayIds(st.overlayIds ?? []);
      setActiveId(st.activeId);
      setLayout(st.layout ?? "grid");
      setFocusView(st.focusView ?? "axial");
      setCursor(st.cursor ?? null);
      setUnitMode(st.unitMode ?? "raw");
      setNormalization(st.normalization ?? null);
      setNormSubjectId(st.normSubjectId ?? null);
      setNormTemplateId(st.normTemplateId ?? null);
      setCentiloidVois(st.centiloidVois ?? null);
      setCentiloidOutcome(st.centiloidOutcome ?? null);
      setTumor(st.tumor ?? null);
      setTumorIndication(st.tumorIndication ?? "lymphoma");
      setTumorTargetId(st.tumorTargetId ?? null);
      setLiverRef(st.liverRef ?? null);
      setDosimetry({ ...emptySetup(), ...(st.dosimetry ?? {}) });
      setMipChoice(st.mipChoice ?? { id: null, lut: null });
      setVoi(null);
      setCoregResults({});
      setProjectionSet(null);
      live.current = { entries: st.entries, referenceId: st.referenceId, activeId: st.activeId, overlayIds: st.overlayIds ?? [] };
      setNotice(tx("Projekt „{name}“ geöffnet: {length} {v}.", { name: file.name, length: st.entries.length, v: st.entries.length === 1 ? "Datensatz" : tx("Datensätze") }));
    } catch (e) {
      setProjectError(e instanceof ProjectError ? e.message : tx("Öffnen fehlgeschlagen: {v}", { v: e instanceof Error ? e.message : String(e) }));
    } finally {
      setProjectBusy(null);
    }
  }

  const projectCard = (
    <Card title={tx("Projekt")} persistKey="project">
      <div className="button-row">
        <button className="secondary-btn" disabled={!entries.length || !!projectBusy} onClick={() => void saveProjectFile()}>
          {projectBusy === "save" ? tx("Wird gespeichert …") : tx("Projekt speichern")}
        </button>
        <button className="secondary-btn" disabled={!!projectBusy} onClick={() => projectInput.current?.click()}>
          {projectBusy === "open" ? tx("Wird geöffnet …") : tx("Projekt öffnen …")}
        </button>
      </div>
      <InfoText
        details={
          <>
            {tx("Gespeichert werden alle Datensätze (DICOM-Originaldateien, NIfTI-Volumen, Bearbeitungen, dynamische Frames), Registrierungen, Schlagworte, Anzeige, Normalisierung sowie Centiloid- und Tumorlast-Ergebnisse. Kinetik-Tabellen und Label-Analysen werden nach dem Öffnen neu berechnet. Die Datei enthält die Patientendaten der geladenen Bilder – vertraulich behandeln.")}
          </>
        }
      >
        <T k="Ganze Sitzung als {c}-Datei – enthält Patientendaten." c={<code>{PROJECT_EXTENSION}</code>} />
      </InfoText>
      {projectError && <div className="error-banner">{projectError}</div>}
    </Card>
  );

  const [atlasBusy, setAtlasBusy] = useState(false);
  const [atlasError, setAtlasError] = useState<string | null>(null);

  const [catalogBusy, setCatalogBusy] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [cachedCatalog, setCachedCatalog] = useState<string[]>([]);
  useEffect(() => {
    void cachedEntryIds().then(setCachedCatalog);
  }, []);
  const loadedCatalog = useMemo(() => new Set(entries.map((e) => e.dataset.catalogId).filter((x): x is string => !!x)), [entries]);

  /** Adds a bundled catalogue entry (template, tissue map or atlas) as dataset; probability maps as hot overlay. */
  async function addCatalogEntry(id: string): Promise<Entry | undefined> {
    const e = bundledEntry(id);
    if (!e) return undefined;
    const existing = entries.find((x) => x.dataset.catalogId === id);
    if (existing) return existing;
    setCatalogBusy(id);
    setCatalogError(null);
    try {
      const entry = addDataset(await loadBundledEntry(e));
      if (e.group === "tpm") setEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, display: { window: [0.2, 1], lut: "hot", opacity: 0.5, visible: x.display.visible } } : x)));
      return entry;
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : String(err));
      return undefined;
    } finally {
      setCatalogBusy(null);
    }
  }

  function addOwnTemplate(loaded: LoadedVolume, fileName: string, kind: "T1" | "PET") {
    const d = createDataset(loaded.volume, loaded.source, fileName);
    addDataset({ ...d, template: { name: fileName, kind } });
  }

  function handleUnitModeChange(mode: UnitMode) {
    unitChosen.current = true;
    writeUnitPreference(mode);
    if (mode === unitMode) return;
    // Value inputs of the active dataset keep their meaning.
    if (activeSuv?.ok) {
      const factor = mode === "suv" ? activeSuv.info.factor : 1 / activeSuv.info.factor;
      const convert = (text: string) => {
        const v = parseInput(text);
        return Number.isFinite(v) ? formatInput(v * factor) : text;
      };
      setThreshold(convert(threshold));
      setNewValue(convert(newValue));
    }
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
    // Label images (atlas, segmentation) come back as atlases: label colors, region list, region statistics.
    const ds = loaded.atlas ? { ...d, atlas: loaded.atlas } : d;
    const decision = autoDecision(ds);
    const entry = addDataset(ds, decision);
    loadDecisions.current.push({ name: entryShort({ ...entry }), shown: decision !== "hidden" });
    setError(null);
  }

  /** Runs edits in the worker and stores the result for the active dataset. */
  async function commit(entryId: string, base: LoadedDataset, from: "current" | "original", ops: EditOp[], edits: EditOp[]): Promise<number | null> {
    setEditBusy(true);
    setError(null);
    try {
      const { volume: next, affected } = await runEdits(from === "current" ? base.current : base.original, ops);
      setDataset(entryId, { ...base, current: next, edits });
      if (ops.some(changesGrid) || (from === "original" && base.edits.some(changesGrid))) setVoi(null);
      return affected;
    } catch (e) {
      setError(tx("Bearbeitung fehlgeschlagen: {v}", { v: e instanceof Error ? e.message : String(e) }));
      return null;
    } finally {
      setEditBusy(false);
    }
  }

  async function handleApplyEdit(op: EditOp) {
    if (!dataset || !active || editBusy) return;
    const target = active;
    const affected = await commit(target.id, dataset, "current", [op], [...dataset.edits, op]);
    // Feedback: which dataset changed and how many voxels (value and VOI operations can look subtle in a wide window).
    if (affected !== null && (op.type === "voi" || op.type === "value" || op.type === "thresholdReplace"))
      setNotice(tx("{v} – {v2} Voxel in {v3} geändert.", { v: describeEdit(op, unitFor(target)), v2: affected.toLocaleString("de-DE"), v3: entryShort(target, 30) }));
  }

  /** Space a dataset lives in: common mirror/rotation center only within the same space. */
  const spaceOf = (e: Entry) => (e.dataset.template ? "standard" : e.dataset.derivedFrom && e.dataset.derivedFrom.space !== "nativ" ? "standard" : "patient");
  const groupTarget = (e: Entry): GroupTarget => {
    const v = e.dataset.current;
    return { geometry: v.geometry, dims: [v.nx, v.ny, v.nz], matrix: e.matrix, labels: !!e.dataset.atlas };
  };

  const geometryTargets: GeometryTarget[] = entries.map((e) => ({
    id: e.id,
    label: entryLabel(e),
    defaultOn: !e.dataset.template,
    disabledReason: e.dataset.dynamic ? tx("dynamisch – nicht möglich") : undefined,
    note: e.dataset.template ? "Vorlage" : active && spaceOf(e) !== spaceOf(active) ? tx("anderer Raum: eigene Mitte") : undefined,
  }));

  /** Flip / rotate / resample several datasets together (one undo step per dataset, linked by a group id). */
  async function handleGeometry(action: GeometryAction, ids: string[]) {
    if (!active || editBusy) return;
    const group = `geo-${Date.now()}`;
    const center = referenceCenter(groupTarget(active));
    const sense = rotationSense(groupTarget(active));
    const skipped: string[] = [];
    setEditBusy(true);
    setError(null);
    try {
      for (const id of ids) {
        const e = byId(id);
        if (!e || e.dataset.dynamic) continue;
        const op = groupEditFor(groupTarget(e), action.kind === "rotate" ? { ...action, sense } : action, spaceOf(e) === spaceOf(active) ? center : null, group);
        if (!op) {
          skipped.push(entryLabel(e));
          continue;
        }
        const { volume: next } = await runEdits(e.dataset.current, [op]);
        updateEntry(id, { dataset: { ...e.dataset, current: next, edits: [...e.dataset.edits, op] } });
      }
      setVoi(null);
      if (skipped.length) setError(tx("Nicht gedreht (Schichten nicht axial): {v}", { v: skipped.join(", ") }));
    } catch (err) {
      setError(tx("Bearbeitung fehlgeschlagen: {v}", { v: err instanceof Error ? err.message : String(err) }));
    } finally {
      setEditBusy(false);
    }
  }

  async function handleUndo() {
    if (!dataset || !active || dataset.edits.length === 0 || editBusy) return;
    const last = dataset.edits[dataset.edits.length - 1];
    const group = "group" in last ? last.group : undefined;
    if (!group) {
      const edits = dataset.edits.slice(0, -1);
      void commit(active.id, dataset, "original", edits, edits);
      return;
    }
    // A common geometry step: undo it in every dataset whose last step it is.
    setEditBusy(true);
    setError(null);
    try {
      for (const e of entries) {
        const l = e.dataset.edits[e.dataset.edits.length - 1];
        if (!l || !("group" in l) || l.group !== group) continue;
        const edits = e.dataset.edits.slice(0, -1);
        const { volume: next } = await runEdits(e.dataset.original, edits);
        updateEntry(e.id, { dataset: { ...e.dataset, current: next, edits } });
      }
      setVoi(null);
    } catch (err) {
      setError(tx("Rückgängig fehlgeschlagen: {v}", { v: err instanceof Error ? err.message : String(err) }));
    } finally {
      setEditBusy(false);
    }
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
        setError(tx("Rekonstruktion fehlgeschlagen: {v}", { v: String(e instanceof Error ? e.message : e) }));
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
  // Acquisition groups: datasets with the same frame of reference (or a label map named after its source) move
  // together; the primary (base, else CT/MR, else the first intensity image) is registered, the others follow.
  const frameOf = (e: Entry) => e.dataset.current.geometry.frameOfReferenceUid;
  const groupKey = (e: Entry): string | null => {
    if (e.dataset.template || (e.dataset.derivedFrom && e.dataset.derivedFrom.space !== "nativ")) return null;
    if (frameOf(e)) return `for:${frameOf(e)}`;
    // Label maps without frame of reference (e.g. a re-loaded export "Labels_CT-Organe_<CT name>.nii") belong to the
    // dataset whose name they contain.
    const norm = (s: string) => s.replace(/\.nii(\.gz)?$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const src = entries.find(
      (x) =>
        x.id !== e.id &&
        (tBoth("CT-Organe · {displayName}", { displayName: x.dataset.displayName }).includes(e.dataset.displayName) ||
          tBoth("Läsionen · {displayName}", { displayName: x.dataset.displayName }).includes(e.dataset.displayName) ||
          (!!e.dataset.atlas && !x.dataset.atlas && norm(x.dataset.displayName).length >= 6 && norm(e.dataset.displayName).includes(norm(x.dataset.displayName)))),
    );
    return src ? (frameOf(src) ? `for:${frameOf(src)}` : `id:${src.id}`) : `id:${e.id}`;
  };
  const primaryId = new Map<string, string>();
  {
    const groups = new Map<string, Entry[]>();
    for (const e of entries) {
      const k = groupKey(e);
      if (k) groups.set(k, [...(groups.get(k) ?? []), e]);
      else primaryId.set(e.id, e.id);
    }
    const anatomicalEntry = (e: Entry) => ["CT", "MR"].includes(modalityLabel(e.dataset.source));
    for (const list of groups.values()) {
      const primary =
        list.find((e) => e.id === reference?.id) ?? list.find((e) => !isPassive(e) && anatomicalEntry(e)) ?? list.find((e) => !isPassive(e)) ?? list[0];
      for (const e of list) primaryId.set(e.id, primary.id);
    }
  }
  const membersOf = (id: string) => entries.filter((x) => x.id !== id && primaryId.get(x.id) === id);
  const isPrimary = (e: Entry) => (primaryId.get(e.id) ?? e.id) === e.id;
  const regCandidates = movingCandidates.filter(isPrimary);
  const regSelection = (regSelected ?? regCandidates.filter((e) => !isPassive(e)).map((e) => e.id)).filter((id) => regCandidates.some((e) => e.id === id));

  /** New placement of a dataset; if it is the primary of its acquisition, the others follow (same relative pose). */
  function setMatrixGroup(id: string, next: Mat4) {
    const e = byId(id);
    if (!e) return;
    const delta = multiply4(next, invert4(e.matrix));
    const members = new Set(isPrimary(e) ? membersOf(id).map((x) => x.id) : []);
    setEntries((prev) => prev.map((x) => (x.id === id ? { ...x, matrix: next } : members.has(x.id) ? { ...x, matrix: multiply4(delta, x.matrix) } : x)));
  }

  function selectMoving(id: string) {
    setMovingId(id);
    makeOverlay(id);
  }

  /** Registers the checked datasets one after another onto the base. */
  async function startCoregistration(ids: string[] = regSelection) {
    if (!reference || coregRunning) return;
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
        setMatrixGroup(id, result.matrix);
        setCoregResults((r) => ({ ...r, [id]: { previous, result, accepted: false } }));
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setCoregError(tx("Coregistrierung fehlgeschlagen: {v}", { v: err instanceof Error ? err.message : String(err) }));
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
    if (r) setMatrixGroup(id, r.previous);
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
      method: coregResults[moving.id] ? `${coregSettings.dof === 6 ? tx("rigide") : tx("affin")}, ${coregResults[moving.id].result.cost}` : undefined,
      cost: coregResults[moving.id] ? { name: coregResults[moving.id].result.cost, before: coregResults[moving.id].result.before, after: coregResults[moving.id].result.after } : undefined,
      created: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${moving.dataset.displayName.replace(/[äöüÄÖÜß]/g, umlaut).replace(/[^A-Za-z0-9_.-]+/g, "_")}_to_${reference.dataset.displayName.replace(/[äöüÄÖÜß]/g, umlaut).replace(/[^A-Za-z0-9_.-]+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadMatrix(f: File) {
    if (!moving) return;
    try {
      const t = parseTransformFile(await f.text());
      setMatrixGroup(moving.id, t.matrix);
      discardResultOnly(moving.id);
      setCoregError(null);
    } catch (e) {
      setCoregError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Spatial normalization (standard space) ──
  const templateEntries = entries.filter((e) => e.dataset.template);
  const subjectCandidates = entries.filter((e) => !e.dataset.template && !e.dataset.derivedFrom && !e.dataset.atlas);
  /** All datasets in patient space (not templates, not already in a standard space): transferred together. */
  const patientSpaceEntries = entries.filter((e) => !e.dataset.template && !e.dataset.derivedFrom);
  const modalityRank = (e: Entry) => ["MR", "PT", "NM", "CT"].indexOf(modalityLabel(e.dataset.source)) + 1 || 9;
  const normSubject =
    byId(normSubjectId) && !byId(normSubjectId)!.dataset.template
      ? byId(normSubjectId)
      : [...subjectCandidates].filter((e) => !e.dataset.dynamic).sort((a, b) => modalityRank(a) - modalityRank(b))[0] ?? subjectCandidates[0];
  const subjectModality = normSubject ? modalityLabel(normSubject.dataset.source) : "";
  const guessedKind: TemplateKind = subjectModality === "CT" ? "CT" : ["MR", "NIfTI"].includes(subjectModality) ? "T1" : "PET";
  const subjectKind = normSubjectKindOverride ?? guessedKind;
  // Template: chosen by the user, else the loaded or bundled template matching the subject's contrast.
  const bundledTemplates = BUNDLED.filter((b) => b.templateKind).map((b) => ({ id: b.id, name: b.name, kind: b.templateKind as TemplateKind, space: b.space }));
  const defaultBundled = defaultTemplateId({ kind: subjectKind, modality: subjectModality, tracerHint: normSubject ? tracerHint(normSubject.dataset) : undefined });
  const defaultName = bundledTemplates.find((b) => b.id === defaultBundled)!.name;
  const templateOptions = [
    ...templateEntries.map((e) => ({ id: e.id, label: tx(e.dataset.template!.name), kind: e.dataset.template!.kind })),
    ...bundledTemplates.filter((b) => !templateEntries.some((e) => e.dataset.template?.name === b.name)).map((b) => ({ id: `bundled:${b.id}`, label: tx("{name} · {space} (wird geladen)", { name: tx(b.name), space: b.space }), kind: b.kind })),
  ];
  const autoTemplateId =
    templateEntries.find((e) => e.dataset.template?.name === defaultName)?.id ??
    templateEntries.find((e) => e.dataset.template?.kind === subjectKind && !bundledTemplates.some((b) => b.name === e.dataset.template?.name))?.id ??
    `bundled:${defaultBundled}`;
  const normTemplateChoice = normTemplateId && templateOptions.some((o) => o.id === normTemplateId) ? normTemplateId : autoTemplateId;
  const normTemplate = byId(normTemplateChoice)?.dataset.template ? byId(normTemplateChoice) : undefined;
  const templateKind = templateOptions.find((o) => o.id === normTemplateChoice)?.kind;
  const sameContrast = templateKind === subjectKind;
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
      (p) => setNormProgress({ ...describeCoregProgress(p, affineShare / 2), stage: tx("Affin grob · Stufe {level}/{levels}", { level: p.level, levels: p.levels }) }),
    );
    normRun.current = rough;
    const r0 = await rough.promise;
    const run = runCoregistration(
      T.dataset.current,
      S.dataset.current,
      { dof: 12, cost: opts.cost, levels: [4, 2], coarseSearch: false, initial: r0.matrix, fixedMask: opts.mask },
      (p) => setNormProgress({ ...describeCoregProgress(p, affineShare / 2), fraction: affineShare / 2 + describeCoregProgress(p, affineShare / 2).fraction, stage: tx("Affin fein · Stufe {level}/{levels}", { level: p.level, levels: p.levels }) }),
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
      setNormProgress({ stage: tx("Nichtlinear"), detail: tx("Vorbereitung"), fraction: affineShare });
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

  /** The chosen template as dataset (bundled templates are loaded on demand). */
  async function resolveTemplate(choice: string): Promise<Entry | undefined> {
    const existing = byId(choice);
    if (existing?.dataset.template) return existing;
    const id = choice.replace(/^bundled:/, "");
    setNormProgress({ stage: tx("Vorlage"), detail: tx("wird geladen"), fraction: 0.01 });
    const b = bundledEntry(id === "mni" ? "mni-t1-2" : id);
    if (!b) return undefined;
    const e = addDataset(await loadBundledEntry(b));
    setNormTemplateId(e.id);
    return e;
  }

  /**
   * Normalizes the chosen patient dataset (MR, PET/SPECT or CT) to the matching template and then transfers ALL
   * patient-space datasets (via their registration to the subject) into the standard space.
   */
  function startNormalization() {
    const S = normSubject;
    if (!S || normRunning) return;
    setNormError(null);
    setNormProgress(null);
    setNormRunning(true);
    const transferIds = patientSpaceEntries.map((e) => e.id);
    const nonlinear = sameContrast && normMethod === "nonlinear";
    (async () => {
      const T0 = await resolveTemplate(normTemplateChoice);
      if (!T0) throw new Error(tx("Keine Vorlage."));
      // A 1 mm template is matched on a 2 mm block average (speed, memory); the result is put back on the chosen grid.
      const tpl0 = T0.dataset.template!;
      const coarse = tpl0.components?.length ? { volume: T0.dataset.current, mask: tpl0.mask } : coarseTemplate(T0.dataset.current, tpl0.mask);
      const T: Entry = coarse.volume === T0.dataset.current ? T0 : { ...T0, dataset: { ...T0.dataset, current: coarse.volume, template: { ...tpl0, mask: coarse.mask } } };
      const mask = normUseMask ? (T.dataset.template?.mask ?? undefined) : undefined;
      // CT: limit to the HU range of tissue and bone (metal/contrast outliers would dominate the matching).
      const subject = subjectKind === "CT" ? { ...S, dataset: { ...S.dataset, current: S.dataset.current.withData(Float32Array.from(S.dataset.current.data, (v) => Math.min(2000, Math.max(-1000, v)))) } } : S;
      let n = await estimateNormalization(T, subject, { nonlinear, cost: normCost, mask, regularization: normRegularization });
      let outTemplate = T0;
      if (normOutput === "1mm") {
        setNormProgress({ stage: tx("Ausgabe 1 mm"), detail: tx("MNI 2009c 1 mm wird geladen"), fraction: 0.97 });
        const ref = await addCatalogEntry("mni-t1-1");
        if (!ref) throw new Error(tx("Die 1-mm-Vorlage konnte nicht geladen werden."));
        outTemplate = ref;
      }
      const og = outTemplate.dataset.current;
      if (!sameGrid(n.grid, og)) n = resampleField(n, { nx: og.nx, ny: og.ny, nz: og.nz, geometry: og.geometry });
      setNormalization(n);
      await transferToStandardSpace(n, transferIds, "linear", outTemplate);
    })()
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setNormError(tx("Normalisierung fehlgeschlagen: {v}", { v: e instanceof Error ? e.message : String(e) }));
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
    setFusionStatus(tx("Wird berechnet …"));
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
      const name = tx("Fusion_{v}", { v: stack.map((e) => datasetModality(e.dataset)).join("_") }).replace(/[äöüÄÖÜß]/g, umlaut).replace(/[^A-Za-z0-9_.-]+/g, "_");
      let bytes: Uint8Array<ArrayBuffer>;
      let fileName: string;
      if (format === "nifti") {
        bytes = buildFusionNifti(rgb, grid);
        fileName = `${name}.nii`;
      } else {
        const src = reference.dataset.source.kind === "dicom" ? reference.dataset.source.files[0].dataSet : undefined;
        const files = buildFusionDicomSeries(rgb, grid, { seriesDescription: tx("Fusion {v}", { v: stack.map((e) => datasetModality(e.dataset)).join("+") }), source: src, anonymize });
        bytes = buildZip(files.map((f) => ({ name: `${name}/${f.name}`, bytes: f.bytes })));
        fileName = `${name}.zip`;
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = withPatientId(fileName);
      a.click();
      URL.revokeObjectURL(url);
      setFusionStatus(`${fileName}: ${grid.nx} × ${grid.ny} × ${grid.nz}, ${grid.geometry.spacing.map((v) => v.toFixed(2)).join(" × ")} mm.`);
    } catch (e) {
      setFusionStatus(tx("Export fehlgeschlagen: {v}", { v: e instanceof Error ? e.message : String(e) }));
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
  const tumorRawUnit = tumorEntry ? (tumorEntry.dataset.valueUnit ?? rawUnitLabel(unitSource(tumorEntry.dataset))) : "";
  const tumorRawMax = useMemo(() => {
    let m = 0;
    for (const v of tumorEntry?.dataset.current.data ?? []) if (v > m) m = v;
    return m;
  }, [tumorEntry?.dataset.current]);

  const organEntries = entries.filter((e) => e.dataset.atlas && e.id !== tumor?.datasetId);
  // The included lesions as a regular label dataset ("Läsionen · PET"): shown, analysed, exported and saved like
  // every other dataset; kept in sync with the tumor result (include/exclude, brush) and the PET's placement.
  const lesionPet = tumor ? byId(tumor.entryId) : undefined;
  useEffect(() => {
    if (!tumor || !lesionPet) return;
    const inc = new Map(tumor.lesions.filter((l) => l.included).map((l) => [l.id, l]));
    const data = new Float32Array(tumor.labels.length);
    for (let i = 0; i < data.length; i++) if (inc.has(tumor.labels[i])) data[i] = tumor.labels[i];
    const labels = new Map(
      [...inc.values()].sort((a, b) => a.id - b.id).map((l) => [l.id, `${tx("Läsion {id}", { id: l.id })}${l.organ ? ` · ${l.organ.replace(/_/g, " ")}` : ""}${l.bone ? ` · ${tx("Knochen")}` : ""}`] as [number, string]),
    );
    const name = tx("Läsionen · {displayName}", { displayName: lesionPet.dataset.displayName });
    const atlas = { name: tx("Läsionen ({description}) · {displayName}", { description: tumor.description, displayName: lesionPet.dataset.displayName }), labels };
    const vol = lesionPet.dataset.current.withData(data);
    const existing = tumor.datasetId ? entries.find((x) => x.id === tumor.datasetId) : undefined;
    if (existing) {
      setEntries((prev) => prev.map((x) => (x.id === existing.id ? { ...x, matrix: lesionPet.matrix, dataset: { ...x.dataset, original: vol, current: vol, atlas } } : x)));
    } else {
      const id = `ds${nextEntryId++}`;
      const d = createDataset(vol, { kind: "reconstruction" }, name);
      setEntries((prev) => [...prev, { id, dataset: { ...d, atlas }, display: { window: [0, 255], lut: "labels", opacity: 0.55, visible: true, nearest: true }, matrix: lesionPet.matrix }]);
      addOverlay(id);
      setTumor((t) => (t ? { ...t, datasetId: id } : t));
    }
  }, [tumor?.labels, tumor?.lesions, tumor?.version, lesionPet?.matrix, lesionPet?.dataset.current]); // eslint-disable-line react-hooks/exhaustive-deps

  const organEntry = tumorOrganId === null ? undefined : (byId(tumorOrganId ?? null) ?? organEntries.findLast((e) => /^CT[- ]organ/i.test(e.dataset.displayName)));

  /** Organ labels on the tumor PET grid (through both placements). */
  function organLabelsFor(pet: Entry, organs: Entry): Uint8Array | null {
    const w2v = w2vById.get(organs.id);
    if (!w2v) return null;
    return organsOnGrid(organs.dataset.current, transformedWorldToVoxel(w2v, invert4(pet.matrix)), pet.dataset.current);
  }

  // ── Triple-window CT: lungs and skeleton in their own window inside one soft-tissue window ──
  const [tripleBusy, setTripleBusy] = useState(false);
  const [tripleStatus, setTripleStatus] = useState<string | null>(null);
  const [tripleError, setTripleError] = useState<string | null>(null);

  async function createTripleWindow(r: TripleWindowRequest) {
    const ct = byId(r.ctId), organs = byId(r.organId);
    if (!ct || !organs?.dataset.atlas || tripleBusy) return;
    setTripleBusy(true);
    setTripleError(null);
    setTripleStatus(tx("Organkarte auf das CT-Raster …"));
    try {
      await new Promise((res) => setTimeout(res, 20));
      const ow2v = w2vById.get(organs.id);
      if (!ow2v) throw new Error(tx("Organkarte und CT liegen nicht im selben Raum."));
      const v = ct.dataset.current;
      // Soft lung/bone masks: smoothed on the coarse organ grid, sampled trilinearly per CT voxel (no staircase,
      // no full-resolution mask in memory).
      setTripleStatus(tx("Fenster werden umgerechnet …"));
      const organVol = organs.dataset.current;
      const res = await smoothTripleWindow(
        v,
        organVol,
        transformedWorldToVoxel(ow2v, invert4(ct.matrix)),
        regionTable(organs.dataset.atlas.labels),
        (ind, fwhm) => gaussianSmooth(organVol.withData(ind), fwhm),
        { windows: r.windows, smoothMm: r.smoothMm, rimLungMm: r.marginMm.lung, rimBoneMm: r.marginMm.bone },
        (f) => setTripleStatus(tx("Fenster werden umgerechnet … {v} %", { v: Math.round(f * 100) })),
      );
      const data = res.data;
      const vol = v.withData(data);
      // Replacing the CT as base: free its GPU texture before the new volume is uploaded (two CT-sized
      // float textures at once can exhaust the GPU memory of weaker graphics cards).
      if (reference?.id === ct.id) GlRenderer.get()?.retain(layers.filter((l) => l.id !== ct.id).map((l) => l.volume));
      const name = tx("Triple-Window · {displayName}", { displayName: ct.dataset.displayName });
      const c = (w: [number, number]) => [(w[0] + w[1]) / 2, w[1] - w[0]].map((x) => String(Math.round(x)));
      const [wc, ww] = c(r.windows.soft);
      const d = createDataset(vol, ct.dataset.source, name);
      const dataset: LoadedDataset = {
        ...d,
        kindLabel: "CT 3W",
        valueUnit: "HU*",
        // DICOM export: marked as artificial, soft-tissue window preset.
        headerEdits: [
          ...ct.dataset.headerEdits,
          { tag: "x0008103e", vr: "LO", value: tx("Triple-Window (kuenstlich, nicht diagnostisch)"), scope: "all" },
          { tag: "x00281050", vr: "DS", value: wc, scope: "all" },
          { tag: "x00281051", vr: "DS", value: ww, scope: "all" },
        ],
        ...(ct.dataset.derivedFrom ? { derivedFrom: { ...ct.dataset.derivedFrom, name } } : {}),
      };
      const id = `ds${nextEntryId++}`;
      setEntries((prev) => [...prev, { id, dataset, display: { window: r.windows.soft, lut: "gray", opacity: 1, visible: true }, matrix: ct.matrix, tag: ct.tag ? `${ct.tag} 3W` : undefined }]);
      // Shown instead of the CT when the CT is the base of the view (same grid and placement).
      if (reference?.id === ct.id) setReferenceId(id);
      const l = (ml: number) => (ml / 1000).toFixed(1);
      setTripleStatus(tx("Angelegt: Lunge {v} l, Skelett {v2} l im eigenen Fenster{v3}.", { v: l(res.lungMl), v2: l(res.boneMl), v3: reference?.id === ct.id ? tx(" – als Basis der Ansicht eingesetzt") : tx(" – über „Ebenen“ einblenden") }));
    } catch (e) {
      setTripleStatus(null);
      setTripleError(e instanceof Error ? e.message : String(e));
    } finally {
      setTripleBusy(false);
    }
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
          if (tumorAutoExclude) description += tx("; automatisch ausgeschlossen: {v}", { v: EXCLUSION_PRESETS[tumorIndication].map((n) => n.replace(/_/g, " ")).join(", ") });
        }
      }
      setTumor({ entryId: e.id, labels: r.labels, lesions, description, version: 0, datasetId: tumor?.entryId === e.id ? tumor.datasetId : undefined });
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
    const liverId = [...atlas.labels].find(([, n]) => canonicalName(n) === "liver")?.[0];
    if (liverId === undefined) {
      setTumorError(tx("Keine Leber in den Organmasken."));
      return;
    }
    const c = autoLiverCenter(organs.dataset.current, liverId, 15);
    if (!c) {
      setTumorError(tx("Leber zu klein für eine 3-cm-Referenzkugel."));
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

  /** Review: lesion currently looked at (table order = SUVmax descending). */
  const [focusLesionId, setFocusLesionId] = useState<number | null>(null);
  const lesionOrder = (a: Lesion, b: Lesion) => b.suvMax - a.suvMax;

  /** Confirms (include) or rejects (exclude) a lesion and moves on to the next unreviewed one. */
  function reviewLesion(id: number, include: boolean) {
    if (!tumor) return;
    const lesions = tumor.lesions.map((l) => (l.id === id ? { ...l, included: include, reviewed: true } : l));
    setTumor({ ...tumor, lesions, version: tumor.version + 1 });
    const sorted = [...lesions].sort(lesionOrder);
    const i = sorted.findIndex((l) => l.id === id);
    const next = [...sorted.slice(i + 1), ...sorted.slice(0, i)].find((l) => !l.reviewed);
    if (next) gotoLesion(next.id);
  }

  /** Removes the rejected/excluded lesions for good and renumbers the remaining ones by SUVmax. */
  function cleanupTumor() {
    if (!tumor) return;
    const removed = tumor.lesions.filter((l) => !l.included).length;
    if (!removed) return;
    if (!window.confirm(tx("{removed} ausgeschlossene Läsion(en) endgültig entfernen und die übrigen nach SUVmax neu nummerieren (1 = höchster SUVmax)?", { removed }))) return;
    const r = cleanupLesions(tumor.labels, tumor.lesions, lesionOrder);
    setTumor({ ...tumor, labels: r.labels, lesions: r.lesions, version: tumor.version + 1 });
    setFocusLesionId(null);
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

  /**
   * Manual lesion at the crosshair: maximum within 10 mm, 3D region growing down to `fraction` × maximum (max. 60 mm
   * from the maximum), added as a new, confirmed lesion. Starts a new result when none exists for this PET/SPECT.
   */
  function addLesionAtCursor(fraction: number) {
    const e = tumorEntry;
    const w2v = e && w2vById.get(e.id);
    setTumorError(null);
    if (!e || !w2v) return;
    if (!cursor) return setTumorError(tx("Erst das Fadenkreuz in die Läsion setzen (Klick in den Viewer)."));
    const v = e.dataset.current;
    const seed = applyWorldToVoxel(w2v, cursor).map(Math.round) as [number, number, number];
    if (seed.some((x, a) => x < 0 || x >= [v.nx, v.ny, v.nz][a])) return setTumorError(tx("Das Fadenkreuz liegt außerhalb dieses Datensatzes."));
    const same = tumor && tumor.entryId === e.id;
    const labels = same ? tumor.labels : new Int32Array(v.data.length);
    const r = growLesion(v, seed, { fraction, occupied: labels });
    if (!r || !r.voxels.length) return setTumorError(tx("Keine Aktivität in der Nähe des Fadenkreuzes (10 mm) – oder dort ist schon eine Läsion."));
    const id = (same ? tumor.lesions.reduce((m, l) => Math.max(m, l.id), 0) : 0) + 1;
    const next = same ? labels.slice() : labels;
    for (const p of r.voxels) next[p] = id;
    const prev = same ? tumor.lesions : [];
    const lesions = lesionStats(v, next, tumorFactor, prev).map((l) =>
      l.id === id ? { ...l, included: true, reviewed: true, note: tx("manuell, Grenze {v} % des Maximums", { v: Math.round(fraction * 100) }) } : l,
    );
    const pctText = tx("manuell: Region Growing ab Fadenkreuz, {v} % des Läsionsmaximums", { v: Math.round(fraction * 100) });
    setTumor(
      same
        ? { ...tumor, labels: next, lesions, version: tumor.version + 1, description: tumor.description.includes("manuell") ? tumor.description : `${tumor.description}; ${pctText}` }
        : { entryId: e.id, labels: next, lesions, description: pctText, version: 0, datasetId: undefined },
    );
    setFocusLesionId(id);
  }

  function gotoLesion(id: number) {
    const e = tumor && byId(tumor.entryId);
    const l = tumor?.lesions.find((x) => x.id === id);
    if (e && l) {
      setCursor(applyMat4(e.matrix, l.centroid));
      setFocusLesionId(id);
    }
  }

  function downloadBytes(bytes: Uint8Array<ArrayBuffer>, name: string, type = "application/octet-stream") {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = withPatientId(name);
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportTumorCsv() {
    const e = tumor && byId(tumor.entryId);
    if (!tumor || !e) return;
    const csv = burdenCsv(tumorBurden(tumor.lesions), tumor.lesions, { dataset: e.dataset.displayName, method: tumor.description, tlgLabel: tumorIndication === "psma" ? "TL-PSMA" : "TLG" });
    downloadBytes(new TextEncoder().encode("\ufeff" + csv) as Uint8Array<ArrayBuffer>, tx("Tumorlast_{v}.csv", { v: e.dataset.displayName.replace(/[äöüÄÖÜß]/g, umlaut).replace(/[^A-Za-z0-9_.-]+/g, "_") }), "text/csv;charset=utf-8");
  }

  function exportTumorNifti() {
    const e = tumor && byId(tumor.entryId);
    if (!tumor || !e) return;
    const inc = new Set(tumor.lesions.filter((l) => l.included).map((l) => l.id));
    const data = new Float32Array(tumor.labels.length);
    for (let i = 0; i < data.length; i++) if (inc.has(tumor.labels[i])) data[i] = tumor.labels[i];
    const atlas = { name: tx("Läsionen · {displayName}", { displayName: e.dataset.displayName }), labels: new Map([...inc].sort((a, b) => a - b).map((id) => [id, tx("Läsion {id}", { id })] as [number, string])) };
    downloadBytes(buildNiftiFile(e.dataset.current.withData(data), { atlas }), tx("Laesionen_{v}.nii", { v: e.dataset.displayName.replace(/\.nii(\.gz)?$/i, "").replace(/[äöüÄÖÜß]/g, umlaut).replace(/[^A-Za-z0-9_.-]+/g, "_") }));
  }

  // ── CT organ segmentation (browser, ONNX) ──
  /** Adds a segmentation result as label dataset (atlas) of the CT, shown as overlay. */
  function addCtSegResult(ct: NonNullable<ReturnType<typeof byId>>, r: CtSegResult, model: CtModelInfo) {
    const g = r.grid.geometry;
    const vol = new Volume3D(Float32Array.from(r.labels), r.grid.nz, r.grid.ny, r.grid.nx, [g.spacing[2], g.spacing[1], g.spacing[0]], { ...g, frameOfReferenceUid: ct.dataset.current.geometry.frameOfReferenceUid });
    const labels = new Map(Object.entries(r.meta.labels).filter(([k]) => k !== "0").map(([k, v]) => [Number(k), v.replace(/_/g, " ")]));
    const d = createDataset(vol, { kind: "reconstruction" }, tx("CT-Organe · {displayName}", { displayName: ct.dataset.displayName }));
    const entry = addDataset({ ...d, atlas: { name: tx("CT-Organe ({short}) · {displayName}", { short: tx(model.short), displayName: ct.dataset.displayName }), labels, attribution: model.attribution } });
    updateEntry(entry.id, { matrix: ct.matrix });
    addOverlay(entry.id);
  }

  /** Model comparison: every chosen model in turn on one CT; runtime and (with a reference label image) Dice. */
  async function startSegBenchmark(ctId: string, refId: string | null, modelIds: string[], backend: CtSegBackend, keep: boolean) {
    const ct = byId(ctId);
    const ref = refId ? byId(refId) : null;
    if (!ct || benchRunning || ctSegRunning) return;
    benchCancel.current = false;
    setBenchRunning(true);
    setBenchResults([]);
    setBenchInfo({ ct: entryLabel(ct), reference: ref ? entryLabel(ref) : null });
    const results: SegBenchmarkResult[] = [];
    try {
      for (const id of modelIds) {
        if (benchCancel.current) break;
        const model = CT_MODELS.find((m) => m.id === id)!;
        const t0 = performance.now();
        const run = runCtSegmentation(ct.dataset.current, backend, (p) =>
          setBenchProgress(`${tx(model.label)}: ${p.stage}${p.total > 0 && p.inference ? ` · ${tx("Kachel {n}/{total}", { n: Math.min(p.done + 1, p.total), total: p.total })}` : ""}`), id);
        ctSegRun.current = run;
        let res: SegBenchmarkResult;
        try {
          const r = await run.promise;
          res = { modelId: id, seconds: (performance.now() - t0) / 1000, backend: r.backend === "webgpu" ? "WebGPU" : "CPU", structures: new Set(r.labels).size - 1 };
          if (ref?.dataset.atlas) {
            setBenchProgress(tx("{label}: Vergleich mit der Referenz …", { label: tx(model.label) }));
            await new Promise((ok) => setTimeout(ok, 0));
            const rv = ref.dataset.current;
            const pred = resampleInto({ ...r.grid, data: r.labels }, worldToVoxelTransform(r.grid.geometry), rv, "nearest");
            const sc = compareLabelMaps(pred, r.meta.labels, rv.data, ref.dataset.atlas.labels);
            res.dice = Object.fromEntries(sc.map((x) => [x.name, x.dice]));
          }
          if (keep) addCtSegResult(ct, r, model);
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") break;
          res = { modelId: id, seconds: (performance.now() - t0) / 1000, backend: "", structures: 0, error: e instanceof Error ? e.message : String(e) };
        }
        results.push(res);
        setBenchResults([...results]);
      }
    } finally {
      ctSegRun.current = null;
      setBenchRunning(false);
      setBenchProgress(null);
    }
  }

  /** Starts the CT organ segmentation; resolves true when the organ map was added (false on error/cancel). */
  function startCtSegmentation(ctId: string, backend: CtSegBackend, modelId: string = DEFAULT_CT_MODEL): Promise<boolean> {
    const ct = byId(ctId);
    if (!ct || ctSegRunning) return Promise.resolve(false);
    setCtSegRunning(true);
    setCtSegError(null);
    setCtSegStatus(null);
    setCtSegProgress(null);
    const t0 = performance.now();
    const model = CT_MODELS.find((m) => m.id === modelId) ?? CT_MODELS[0];
    const run = runCtSegmentation(ct.dataset.current, backend, setCtSegProgress, model.id);
    ctSegRun.current = run;
    return run.promise
      .then((r) => {
        const g = r.grid.geometry;
        addCtSegResult(ct, r, model);
        let n = 0;
        for (const v of r.labels) if (v) n++;
        setCtSegStatus(
          tx("{short}: fertig in {s} s ({backend}): {n} Strukturen, {l} l segmentiert.", { short: tx(model.short), s: ((performance.now() - t0) / 1000).toFixed(0), backend: r.backend === "webgpu" ? "WebGPU" : "CPU", n: new Set(r.labels).size - 1, l: fmtFixed((n * g.spacing[0] * g.spacing[1] * g.spacing[2]) / 1e6, 1) }) + (r.note ? ` ${tx(r.note)}.` : ""),
        );
        return true;
      })
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setCtSegError(tx("CT-Segmentierung fehlgeschlagen: {v}", { v: e instanceof Error ? e.message : String(e) }));
        return false;
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
    const table = new Map([[1, tx(VOI_LABELS.ctx)], [2, tx(VOI_LABELS.WhlCbl)], [3, VOI_LABELS.Pons], [4, tx("Hirnstamm (WhlCblBrnStm ohne Kleinhirn)")]]);
    const d = createDataset(base.withData(labels), { kind: "reconstruction" }, "Centiloid-VOIs");
    addDataset({ ...d, atlas: { name: tx("Centiloid-VOIs (GAAIN)"), labels: table } });
  }

  /** VOI means, SUVR, CL and plausibility warnings for a dataset in MNI space. */
  function evaluateCentiloid(target: Entry, calibration: CentiloidCalibration, pipeline: string, extraWarnings: string[] = []): CentiloidOutcome {
    if (!centiloidVois) throw new Error(tx("Zuerst die Centiloid-VOIs laden."));
    const means = voiMeans(target.dataset.current, centiloidVois);
    const result = centiloidFromMeans(means, calibration);
    const warnings = [...extraWarnings];
    const ctx = means.find((m) => m.name === "ctx");
    const ctxMl = centiloidVois.volumes.ctx ? voiVolumeMl(centiloidVois.volumes.ctx) : 0;
    if (ctx && ctxMl > 0 && ctx.volumeMl < 0.9 * ctxMl) warnings.push(tx("Nur {v} % der Kortex-VOI liegen im Datensatz – liegt er im MNI-Raum?", { v: Math.round((100 * ctx.volumeMl) / ctxMl) }));
    if (!Number.isFinite(result.centiloid)) warnings.push(tx("Referenzregion ohne Daten – Centiloid nicht berechenbar."));
    const src = unitSource(target.dataset);
    if (src.kind === "dicom") {
      const w = acquisitionWindow(src.files[0].dataSet);
      if ("reason" in w) warnings.push(tx("Aufnahmezeitfenster nicht prüfbar: {reason}", { reason: w.reason }));
      else {
        const msg = windowWarning(w, calibration);
        if (msg) warnings.push(msg);
        const tracer = guessTracer(w.tracerName);
        if (tracer && calibration.tracer !== "custom" && tracer !== calibration.tracer) warnings.push(tx("Header nennt „{tracerName}“, Kalibrierung ist für {tracer}.", { tracerName: w.tracerName, tracer: calibration.tracer }));
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
          tx("vorhandener Datensatz im MNI-Raum"),
          calibration.pipeline === "recon" ? [tx("GAAIN-kalibrierte Gleichung: gilt nur, wenn der Datensatz mit der affinen Recon-Studio-Normalisierung (T1 → MNI) erstellt wurde – sonst die Standardgleichung wählen.")] : [],
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
        template = templateEntries.find((e) => e.dataset.template?.kind === "T1") ?? (setCentiloidStatus(tx("MNI-Vorlage wird geladen …")), addDataset(await loadBundledMni()));
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
        pipeline = tx("MRT-Pipeline (affin)");
        if (calibration.pipeline === "standard")
          warnings.push(tx("Die gewählte Standardgleichung gilt für die SPM8-Standardmethode – für diese Pipeline die GAAIN-kalibrierte Gleichung wählen."));
      } else {
        const tpl = templateEntries.find((e) => e.dataset.template?.kind === "PET");
        if (!tpl) throw new Error(tx("Für PET-only wird eine PET-Vorlage benötigt."));
        template = tpl;
        setCentiloidStatus(tx("1/3 PET → PET-Vorlage (affin + nichtlinear) …"));
        n = await estimateNormalization(template, pet, { nonlinear: true, cost: "ncc", mask: template.dataset.template?.mask ?? undefined, regularization: normRegularization });
        pipeline = "PET-only";
        warnings.push(tx("PET-only ist nicht an den GAAIN-Daten validiert – Werte nur orientierend; bei Atrophie oder vaskulären Läsionen Normalisierung besonders prüfen."));
      }
      if (centiloidCancelled.current) return;
      if (n.warp && n.warp.foldedFraction > 0) warnings.push(tx("Verformung faltet sich in {v} % der Hirnvoxel.", { v: (100 * n.warp.foldedFraction).toFixed(2) }));
      setNormalization(n);
      setNormSubjectId(n.subjectId);
      setNormTemplateId(template.id);
      setCentiloidStatus(tx("{v} In den MNI-Raum übertragen …", { v: t1 ? "3/4" : "2/3" }));
      const ids = t1 ? [t1.id, pet.id] : [pet.id];
      const created = await transferToStandardSpace(n, ids, "linear", template, overrides);
      const petStd = created.at(-1);
      if (!petStd) throw new Error(tx("Übertragung in den MNI-Raum fehlgeschlagen."));
      setCentiloidStatus(tx("{v} VOIs auswerten …", { v: t1 ? "4/4" : "3/3" }));
      setCentiloidOutcome(evaluateCentiloid(petStd, calibration, pipeline, warnings));
      setCentiloidStatus(null);
    } catch (e) {
      setCentiloidStatus(null);
      if (!(e instanceof DOMException && e.name === "AbortError")) setCentiloidError(tx("Centiloid-Bestimmung fehlgeschlagen: {v}", { v: e instanceof Error ? e.message : String(e) }));
    } finally {
      setCentiloidRunning(false);
      normRun.current = null;
    }
  }

  // ── Atlas / SUVR ──
  async function addBundledAtlas(id = "cerebra-1") {
    const e = bundledEntry(id);
    if (!e || entries.some((x) => x.dataset.catalogId === id)) return;
    setAtlasBusy(true);
    setAtlasError(null);
    try {
      addDataset(await loadBundledEntry(e));
    } catch (err) {
      setAtlasError(err instanceof Error ? err.message : String(err));
    } finally {
      setAtlasBusy(false);
    }
  }

  /** User-downloaded catalogue files (Harvard-Oxford, Brainnetome, …): recognised by name, stored in the browser. */
  async function addUserCatalogFiles(files: File[]) {
    setCatalogError(null);
    const ok = await addOwnAtlas(files, setCatalogError);
    if (ok?.catalogId && (await cacheUserFiles(ok.catalogId, ok.files))) setCachedCatalog(await cachedEntryIds());
  }

  async function loadCachedCatalog(id: string) {
    const files = await cachedUserFiles(id);
    if (!files) {
      setCatalogError(tx("Die gespeicherten Dateien sind nicht mehr vorhanden."));
      setCachedCatalog(await cachedEntryIds());
      return;
    }
    setCatalogBusy(id);
    try {
      await addOwnAtlas(files, setCatalogError);
    } finally {
      setCatalogBusy(null);
    }
  }

  /**
   * Loads a label image (+ table) or a ZIP as atlas. Files of a catalogue entry the user downloads (e.g. FSL's
   * Harvard-Oxford) are recognised by name and get the entry's name, table format and attribution.
   * Returns the catalogue id and the files used, or undefined on failure.
   */
  async function addOwnAtlas(input: File[], onError: (msg: string | null) => void = setAtlasError): Promise<{ catalogId?: string; files: File[] } | undefined> {
    const setAtlasError = onError;
    setAtlasError(null);
    let files = input;
    const zip = input.find((f) => /\.zip$/i.test(f.name));
    if (zip) {
      // e.g. the AAL3 download: label image + table inside the archive.
      try {
        const picked = pickAtlasEntries(listZip(await zip.arrayBuffer()));
        if (!picked) throw new Error(tx("In „{name}“ wurde kein NIfTI-Labelbild gefunden.", { name: zip.name }));
        const toFile = async (e: { name: string; read: () => Promise<Uint8Array<ArrayBuffer>> }) => new File([await e.read()], e.name.split("/").pop()!);
        files = [await toFile(picked.image), ...(picked.table ? [await toFile(picked.table)] : [])];
      } catch (e) {
        setAtlasError(e instanceof Error ? e.message : String(e));
        return undefined;
      }
    }
    const known = identifyUserFiles(files.map((f) => f.name));
    const image = known ? files.find((f) => f.name === known.image)! : files.find((f) => /\.nii(\.gz)?$/i.test(f.name));
    const table = known ? files.find((f) => f.name === known.table) : files.find((f) => f !== image);
    if (!image) {
      setAtlasError(tx("Bitte das Labelbild (NIfTI) mit auswählen."));
      return undefined;
    }
    if (known?.entry.table && !table) {
      setAtlasError(tx("{name}: bitte die Labeltabelle mit auswählen ({instructions})", { name: known.entry.name, instructions: known.entry.instructions }));
      return undefined;
    }
    try {
      const loaded = await loadVolumeFromFiles([image]);
      const text = table ? await table.text() : undefined;
      const labels = text === undefined ? undefined : known?.entry.tableFormat === "fsl-xml" || /\.xml$/i.test(table!.name) ? parseFslAtlasXml(text) : parseLabelTable(text);
      if (table && !labels?.size) throw new Error(tx("In „{name}“ wurden keine Labels erkannt.", { name: table.name }));
      const d = createDataset(loaded.volume, loaded.source, known ? known.entry.name : image.name);
      const atlas = labels || !loaded.atlas ? atlasFromLabels(loaded.volume.data, known ? known.entry.name : image.name.replace(/\.nii(\.gz)?$/i, ""), labels) : loaded.atlas;
      if (known) atlas.attribution = tx("{attribution} Lizenz: {name}.", { attribution: known.entry.attribution, name: known.entry.license.name });
      addDataset({ ...d, atlas, catalogId: known?.entry.id });
      return { catalogId: known?.entry.id, files: [image, ...(table ? [table] : [])] };
    } catch (e) {
      setAtlasError(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  }

  /** Atlas labels on the voxel grid of a dataset (nearest neighbour through the display registration). */
  function atlasLabelsFor(atlasEntry: Entry, target: Entry): Float32Array {
    const a = atlasEntry.dataset.current;
    const v = target.dataset.current;
    if (sameGrid({ nx: a.nx, ny: a.ny, nz: a.nz, geometry: a.geometry }, v) && atlasEntry.matrix.every((x, i) => Math.abs(x - target.matrix[i]) < 1e-9)) return a.data;
    const w2v = w2vById.get(atlasEntry.id);
    if (!w2v) throw new Error(tx("Atlas ist nicht im Viewer verfügbar."));
    // Atlas finer than the dataset (e.g. 1 mm atlas, 2 mm PET): majority of s³ samples per voxel, else nearest neighbour.
    const s = Math.min(3, Math.round(Math.min(...v.geometry.spacing) / Math.max(...a.geometry.spacing)));
    const offsets = s >= 2 ? subVoxelOffsets(s) : [[0, 0, 0] as [number, number, number]];
    const samples = offsets.map(([dx, dy, dz]) => {
      const pts = new Float32Array(v.nx * v.ny * v.nz * 3);
      for (let k = 0, o = 0; k < v.nz; k++)
        for (let j = 0; j < v.ny; j++)
          for (let i = 0; i < v.nx; i++, o += 3) pts.set(applyMat4(target.matrix, voxelToWorld(v.geometry, i + dx, j + dy, k + dz)), o);
      return resampleAtPoints(a, w2v, pts, "nearest");
    });
    return samples.length === 1 ? samples[0] : majorityLabels(samples);
  }

  /** Grey-matter probability (MNI 2009c GM map, if loaded) on the grid of a dataset; undefined if not loaded. */
  function gmOnGrid(target: Entry): Float32Array | undefined {
    const G = entries.find((e) => e.dataset.catalogId === "mni-gm-1");
    const w2v = G && w2vById.get(G.id);
    if (!G || !w2v) return undefined;
    const v = target.dataset.current;
    const pts = new Float32Array(v.nx * v.ny * v.nz * 3);
    for (let k = 0, o = 0; k < v.nz; k++)
      for (let j = 0; j < v.ny; j++)
        for (let i = 0; i < v.nx; i++, o += 3) pts.set(applyMat4(target.matrix, voxelToWorld(v.geometry, i, j, k)), o);
    return resampleAtPoints(G.dataset.current, w2v, pts, "linear");
  }

  /** Labels restricted to grey matter (GM probability ≥ 0.5). */
  function restrictToGm(labels: Float32Array, target: Entry): Float32Array {
    const gm = gmOnGrid(target);
    if (!gm) throw new Error(tx("Die Gewebekarte „Graue Substanz“ ist nicht geladen."));
    return Float32Array.from(labels, (l, i) => (gm[i] >= 0.5 ? l : 0));
  }

  function computeRegions(atlasId: string, targetId: string, gmOnly = false): RegionResult {
    const A = byId(atlasId);
    const E = byId(targetId);
    if (!A?.dataset.atlas || !E) throw new Error(tx("Atlas oder Datensatz nicht gefunden."));
    const v = E.dataset.current;
    const labels = gmOnly ? restrictToGm(atlasLabelsFor(A, E), E) : atlasLabelsFor(A, E);
    const [sx, sy, sz] = v.geometry.spacing;
    const stats = regionStats(v.data, labels, A.dataset.atlas, (sx * sy * sz) / 1000);
    if (!stats.length) throw new Error(tx("Keine Atlasregion überlappt mit dem Datensatz – liegt er im Standardraum des Atlas?"));
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
        name = tx("CT-Organe (TotalSegmentator)");
      } else {
        const text = await src.text();
        table = /<Label\b/.test(text) ? parseXmlLabelTable(text) : parseLabelTable(text);
        if (!table.size) throw new Error(tx("In „{name}“ wurden keine Labels erkannt.", { name: src.name }));
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
    if (!A?.dataset.atlas || !E) throw new Error(tx("Labels oder Datensatz nicht gefunden."));
    const v = E.dataset.current;
    const labels = atlasLabelsFor(A, E);
    const { scale, label } = unitFor(E);
    const values = scale === 1 ? v.data : Float32Array.from(v.data, (x) => x * scale);
    const [sx, sy, sz] = v.geometry.spacing;
    const stats = regionStats(values, labels, A.dataset.atlas, (sx * sy * sz) / 1000);
    if (!stats.length) throw new Error(tx("Keine Region überlappt mit dem Datensatz – liegen Labels und Datensatz im selben Raum (Registrierung, Standardraum)?"));
    const a = A.dataset.current;
    const resampled = labels !== a.data;
    return {
      stats,
      values,
      labels,
      unit: label,
      datasetLabel: entryLabel(E),
      note: resampled
        ? tx("Labels „{v}“ über die Registrierung auf das Raster von „{v2}“ übertragen ({v3}).", { v: entryLabel(A), v2: entryLabel(E), v3: Math.min(...E.dataset.current.geometry.spacing) / Math.max(...a.geometry.spacing) >= 1.5 ? tx("Mehrheit der Teilvoxel") : tx("nächster Nachbar") })
        : undefined,
    };
  }

  function createSuvrImage(targetId: string, refMean: number, refLabel: string) {
    const E = byId(targetId);
    if (!E || !(refMean > 0)) return;
    const v = E.dataset.current;
    const data = new Float32Array(v.data.length);
    for (let i = 0; i < data.length; i++) data[i] = v.data[i] / refMean;
    const d = createDataset(v.withData(data), E.dataset.source, `${E.dataset.displayName} · SUVR`);
    const derived: LoadedDataset = { ...d, derivedFrom: { name: tx("{displayName} (SUVR, Referenz: {refLabel})", { displayName: E.dataset.displayName, refLabel }), source: { kind: "reconstruction" }, space: E.dataset.derivedFrom?.space ?? "nativ", label: "SUVR" } };
    const id = `ds${nextEntryId++}`;
    setEntries((prev) => [...prev, { id, dataset: derived, display: { window: [0, 3], lut: "hot", opacity: 0.6, visible: true }, matrix: E.matrix }]);
    addOverlay(id);
    setActiveId(id);
  }

  // ── IMCALC: voxelwise arithmetic → new datasets on the grid of the inputs ──
  const [imcalcBusy, setImcalcBusy] = useState<string | null>(null);
  const [imcalcStatus, setImcalcStatus] = useState<string | null>(null);
  const [imcalcError, setImcalcError] = useState<string | null>(null);
  const [imcalcResults, setImcalcResults] = useState<string[]>([]);
  const imcalcInputs = entries.filter((e) => !e.dataset.atlas);

  /** Result dataset on the grid (and in the space/placement) of `input`; returns its id. */
  function addImcalcResult(input: Entry, data: Float32Array, name: string, opts: { kind: string; unit: string; window?: [number, number]; lut?: LayerDisplay["lut"]; show: boolean }): string {
    const vol = input.dataset.current.withData(data);
    const d = createDataset(vol, { kind: "reconstruction" }, name);
    const inStandard = input.dataset.derivedFrom && input.dataset.derivedFrom.space !== "nativ";
    const dataset: LoadedDataset = {
      ...d,
      kindLabel: opts.kind,
      ...(opts.unit ? { valueUnit: opts.unit } : {}),
      ...(inStandard ? { derivedFrom: { name, source: { kind: "reconstruction" as const }, space: input.dataset.derivedFrom!.space } } : {}),
    };
    const auto = defaultDisplay(vol);
    const lut = opts.lut ?? (input.display.lut === "gray" || input.display.lut === "labels" ? "hot" : input.display.lut);
    const id = `ds${nextEntryId++}`;
    setEntries((prev) => [...prev, { id, dataset, display: { window: opts.window ?? auto.window, lut, opacity: 0.7, visible: true }, matrix: input.matrix }]);
    if (opts.show) {
      addOverlay(id);
      setActiveId(id);
    }
    return id;
  }

  async function runImcalc(job: ImcalcJob) {
    if (imcalcBusy) return;
    setImcalcError(null);
    setImcalcStatus(null);
    const input = (id: string) => {
      const e = byId(id);
      if (!e) throw new Error(tx("Datensatz nicht gefunden."));
      return { e, x: { data: e.dataset.current.data, scale: unitFor(e).scale }, unit: unitFor(e).label };
    };
    const check = (list: Entry[]) => {
      const g = list[0].dataset.current;
      const grid = { nx: g.nx, ny: g.ny, nz: g.nz, geometry: g.geometry };
      const bad = list.find((e) => !sameGrid(grid, e.dataset.current));
      if (bad) throw new Error(tx("„{v}“ liegt auf einem anderen Raster als „{v2}“.", { v: entryLabel(bad), v2: entryLabel(list[0]) }));
    };
    const created: string[] = [];
    try {
      if (job.kind === "linear") {
        setImcalcBusy("Linear");
        const a = input(job.id);
        const r = await linear(a.x, job.a, job.b);
        created.push(addImcalcResult(a.e, r, job.name, { kind: "IMCALC", unit: a.unit, show: true }));
      } else if (job.kind === "pair") {
        setImcalcBusy(tx("Zwei Datensätze"));
        const a = input(job.id1), b = input(job.id2);
        check([a.e, b.e]);
        const r = job.op === "sum" ? await combine(a.x, b.x, job.a, job.b) : job.op === "product" ? await product(a.x, b.x) : await quotient(a.x, b.x);
        const unit = job.op === "sum" ? (a.unit === b.unit ? a.unit : "") : job.op === "quotient" ? tx("Verhältnis") : "";
        // Differences (coefficients of opposite sign): diverging colors, window symmetric around 0.
        const signed = job.op === "sum" && job.a * job.b < 0;
        let sym = 0;
        if (signed) {
          const abs = Float32Array.from(r, Math.abs).filter((v) => v > 0).sort();
          sym = abs.length ? abs[Math.floor(0.995 * (abs.length - 1))] : 1;
        }
        const look = job.op === "quotient" ? { window: [0, 2] as [number, number], lut: "hot" as const } : signed ? { window: [-sym, sym] as [number, number], lut: "diverging" as const } : {};
        created.push(addImcalcResult(a.e, r, job.name, { kind: "IMCALC", unit, show: true, ...look }));
      } else if (job.kind === "group") {
        const xs = job.ids.map(input);
        check(xs.map((x) => x.e));
        setImcalcBusy(tx("Gruppe (n={length})", { length: xs.length }));
        const r = await groupMeanSd(
          xs.map((x) => x.x),
          (f) => setImcalcStatus(tx("Gruppe: {v} %", { v: Math.round(f * 100) })),
        );
        created.push(addImcalcResult(xs[0].e, r.mean, job.nameMean, { kind: "IMCALC", unit: xs[0].unit, show: true }));
        created.push(addImcalcResult(xs[0].e, r.sd, job.nameSd, { kind: "IMCALC", unit: xs[0].unit, lut: "hot", show: false }));
      } else {
        const m = input(job.meanId), sd = input(job.sdId);
        const xs = job.ids.map(input);
        check([m.e, sd.e, ...xs.map((x) => x.e)]);
        for (const [i, x] of xs.entries()) {
          setImcalcBusy(tx("Z-Karte {v}/{length}", { v: i + 1, length: xs.length }));
          const r = await zScore(x.x, m.x, sd.x);
          created.push(addImcalcResult(x.e, r, `${x.e.tag || baseName(x.e)}${job.suffix}`, { kind: "Z", unit: "z", window: [-4, 4], lut: "diverging", show: i === 0 }));
        }
      }
      setImcalcResults((prev) => [...prev, ...created]);
      setImcalcStatus(tx("{length} {v} angelegt{v2}.", { length: created.length, v: created.length === 1 ? "Datensatz" : tx("Datensätze"), v2: created.length > 1 ? tx(" – weitere über „Ebenen“ einblenden") : "" }));
    } catch (e) {
      setImcalcError(e instanceof Error ? e.message : String(e));
      setImcalcStatus(null);
    } finally {
      setImcalcBusy(null);
    }
  }

  // ── Kinetics (dynamic PET) ──
  /**
   * Normalizes a dynamic dataset to MNI (mean image → T1 rigid, T1 → MNI affine; without T1 affine to the SPM PET
   * template), creates the mean in MNI space and transfers every frame along the same mapping.
   */
  async function kineticsToMni(id: string, t1Id: string | null, status: (s: string) => void, window: { fromMin: number; toMin: number }): Promise<string> {
    const D0 = byId(id);
    const dyn = D0?.dataset.dynamic;
    if (!D0 || !dyn) throw new Error(tx("Dynamischer Datensatz nicht gefunden."));
    // Registration image: duration-weighted sum of the frames whose mid time lies in the chosen window.
    const sel = dyn.frames.map((_, i) => i).filter((i) => {
      const mid = (dyn.start[i] + dyn.duration[i] / 2) / 60;
      return mid >= window.fromMin && mid <= window.toMin;
    });
    if (!sel.length) throw new Error(tx("Im gewählten Zeitfenster liegt kein Frame."));
    const regImage = D0.dataset.current.withData(meanOfFrames(sel.map((i) => dyn.frames[i]), sel.map((i) => dyn.duration[i])));
    const D: Entry = { ...D0, dataset: { ...D0.dataset, current: regImage } };
    const overrides = new Map<string, Mat4>();
    let n: Normalization;
    let template: Entry;
    let subject: Entry = D;
    if (t1Id) {
      const t1 = byId(t1Id);
      if (!t1) throw new Error(tx("T1 nicht gefunden."));
      subject = t1;
      template = templateEntries.find((e) => e.dataset.template?.kind === "T1") ?? (status(tx("MNI-Vorlage wird geladen")), addDataset(await loadBundledMni()));
      status(tx("Mittelbild → T1 (rigide)"));
      const run = runCoregistration(t1.dataset.current, D.dataset.current, { dof: 6, cost: "nmi", levels: [8, 4, 2], coarseSearch: true, initial: multiply4(invert4(t1.matrix), D.matrix) });
      normRun.current = run;
      const reg = await run.promise;
      const m = multiply4(t1.matrix, reg.matrix);
      updateEntry(D.id, { matrix: m });
      overrides.set(D.id, m);
      status("T1 → MNI (affin)");
      n = await estimateNormalization(template, t1, { nonlinear: false, cost: "ncc", mask: template.dataset.template?.mask ?? undefined, regularization: normRegularization });
    } else {
      const spm = BUNDLED_PET_TEMPLATES[0];
      template = templateEntries.find((e) => e.dataset.template?.name === spm.name) ?? (status(tx("PET-Vorlage wird geladen")), addDataset(await loadBundledPetTemplate(spm.id)));
      status(tx("Mittelbild → SPM-PET-Vorlage (affin)"));
      n = await estimateNormalization(template, D, { nonlinear: false, cost: "ncc", mask: template.dataset.template?.mask ?? undefined, regularization: normRegularization });
    }
    status(tx("Mittelbild in den MNI-Raum"));
    const created = await transferToStandardSpace(n, [D.id], "linear", template, overrides);
    const target = created[0];
    if (!target) throw new Error(tx("Übertragung in den MNI-Raum fehlgeschlagen."));
    status(tx("{length} Frames werden übertragen", { length: dyn.frames.length }));
    const points = pullbackPositions(n, overrides.get(subject.id) ?? subject.matrix);
    const v = D.dataset.current;
    const r = await runKineticsJob<{ frames: Float32Array[] }>(
      { type: "toTemplate", frames: dyn.frames, grid: { nx: v.nx, ny: v.ny, nz: v.nz, geometry: v.geometry }, toSubject: overrides.get(D.id) ?? D.matrix, points },
      (d, t) => status(tx("Frames werden übertragen ({d}/{t})", { d, t })),
    ).promise;
    const mean = target.dataset.current.withData(meanOfFrames(r.frames, dyn.duration));
    const dataset: LoadedDataset = { ...target.dataset, original: mean, current: mean, dynamic: { ...dyn, frames: r.frames } };
    updateEntry(target.id, { dataset });
    return target.id;
  }

  const dosimetryApi: DosimetryApi = {
    entries: entries.map((e) => ({ id: e.id, label: entryLabel(e), dataset: e.dataset, matrix: e.matrix, modality: ctEntries.includes(e) ? "CT" : datasetModality(e.dataset) })),
    setup: dosimetry,
    onSetup: setDosimetry,
    segmentCt: (ctId, modelId) => void startCtSegmentation(ctId, "auto", modelId),
    segmentCts: async (ctIds, modelId, status) => {
      for (const [n, id] of ctIds.entries()) {
        status(tx("Organsegmentierung {v}/{length}: {v2}", { v: n + 1, length: ctIds.length, v2: entryLabel(byId(id)!) }));
        if (!(await startCtSegmentation(id, "auto", modelId))) return false;
      }
      return true;
    },
    showTimePoint: (baseId, overlayIds) => {
      changeBase(baseId);
      for (const id of overlayIds) makeOverlay(id);
      setOverlayIds(overlayIds.filter((id) => id !== baseId));
      setEntries((prev) => prev.map((e) => (overlayIds.includes(e.id) ? { ...e, display: { ...e.display, visible: true } } : e)));
      if (overlayIds[0]) setActiveId(overlayIds[0]);
    },
    segRunning: ctSegRunning,
    registerTimePoints: async (refCtId, pairs, status) => {
      const refCt = byId(refCtId);
      if (!refCt) throw new Error(tx("Referenz-CT nicht gefunden."));
      for (const [n, p] of pairs.entries()) {
        const ct = live.current.entries.find((e) => e.id === p.ctId);
        if (!ct) continue;
        status(tx("Registrierung {v}/{length}: {v2}", { v: n + 1, length: pairs.length, v2: entryLabel(ct) }));
        const run = runCoregistration(refCt.dataset.current, ct.dataset.current, { dof: 6, cost: "ncc", levels: [8, 4, 2], coarseSearch: true, initial: multiply4(invert4(refCt.matrix), ct.matrix) });
        const result = await run.promise;
        const next = multiply4(refCt.matrix, result.matrix);
        // Followers keep their pose relative to the CT of their time point.
        const delta = multiply4(next, invert4(ct.matrix));
        setEntries((prev) => prev.map((e) => (e.id === ct.id ? { ...e, matrix: next } : p.followers.includes(e.id) ? { ...e, matrix: multiply4(delta, e.matrix) } : e)));
        live.current = { ...live.current, entries: live.current.entries.map((e) => (e.id === ct.id ? { ...e, matrix: next } : p.followers.includes(e.id) ? { ...e, matrix: multiply4(delta, e.matrix) } : e)) };
      }
    },
    putDoseMap: (refSpectId, data, name, replaceId) => {
      const ref = byId(refSpectId);
      if (!ref) throw new Error(tx("Referenz-SPECT nicht gefunden."));
      const vol = ref.dataset.current.withData(data);
      let max = 0;
      for (const v of data) if (v > max) max = v;
      if (replaceId && byId(replaceId)) {
        setEntries((prev) => prev.map((e) => (e.id === replaceId ? { ...e, matrix: ref.matrix, dataset: { ...e.dataset, original: vol, current: vol, displayName: name }, display: { ...e.display, window: [0, max || 1] } } : e)));
        return replaceId;
      }
      const d = createDataset(vol, { kind: "reconstruction" }, name);
      const id = `ds${nextEntryId++}`;
      setEntries((prev) => [...prev, { id, dataset: { ...d, kindLabel: "Dosis", valueUnit: "Gy" }, display: { window: [0, max || 1], lut: "hot", opacity: 0.6, visible: true }, matrix: ref.matrix }]);
      addOverlay(id);
      setActiveId(id);
      return id;
    },
    showDataset: (id) => {
      makeOverlay(id);
      setActiveId(id);
    },
    onActivity: setDosimetryActivity,
  };

  const kineticsApi: KineticsApi = {
    dynamics: entries.filter((e) => e.dataset.dynamic).map((e) => ({ id: e.id, label: entryLabel(e), dataset: e.dataset, inMni: !!e.dataset.derivedFrom })),
    t1s: subjectCandidates.filter((e) => !e.dataset.dynamic).sort((a, b) => Number(isAnatomical(unitSource(b.dataset))) - Number(isAnatomical(unitSource(a.dataset)))).map((e) => ({ id: e.id, label: entryLabel(e) })),
    atlases: entries.filter((e) => e.dataset.atlas).map((e) => ({ id: e.id, label: entryLabel(e), atlas: e.dataset.atlas! })),
    onActivity: setKineticsActivity,
    setTiming: (id, start, duration) => {
      const e = byId(id);
      if (e?.dataset.dynamic) setDataset(id, { ...e.dataset, dynamic: { ...e.dataset.dynamic, start, duration, timeSource: "manuell", note: undefined } });
    },
    applyMotion: (id, frames, motion: FrameMotion[]) => {
      const e = byId(id);
      if (!e?.dataset.dynamic) return;
      const mean = e.dataset.current.withData(meanOfFrames(frames, e.dataset.dynamic.duration));
      setDataset(id, { ...e.dataset, original: mean, current: mean, edits: [], dynamic: { ...e.dataset.dynamic, frames, motion: motion.map(({ t, r, maxShiftMm, registered }) => ({ t, r, maxShiftMm, registered })) } });
    },
    toMni: kineticsToMni,
    labelsFor: (atlasId, targetId) => {
      const A = byId(atlasId), T = byId(targetId);
      if (!A || !T) throw new Error(tx("Atlas oder Datensatz nicht gefunden."));
      return atlasLabelsFor(A, T);
    },
    addMaps: (sourceId, maps) => {
      const E = byId(sourceId);
      if (!E) return [];
      const v = E.dataset.current;
      const made: { id: string; label: string }[] = [];
      for (const m of maps) {
        const d = createDataset(v.withData(m.data), { kind: "reconstruction" }, `${E.dataset.displayName} · ${m.label}`);
        const derived: LoadedDataset = { ...d, derivedFrom: { name: `${E.dataset.displayName} (${m.label})`, source: { kind: "reconstruction" }, space: E.dataset.derivedFrom?.space ?? "nativ", label: m.label.split(" ")[0] } };
        const id = `ds${nextEntryId++}`;
        setEntries((prev) => [...prev, { id, dataset: derived, display: { window: m.window, lut: "hot", opacity: 0.6, visible: m.visible !== false }, matrix: E.matrix }]);
        if (m.visible !== false) addOverlay(id);
        made.push({ id, label: m.label });
      }
      return made;
    },
    showDataset: (id) => {
      setEntries((prev) => prev.map((x) => (x.id === id ? { ...x, display: { ...x.display, visible: true } } : x)));
      addOverlay(id);
    },
    loadCerebra: () => void addBundledAtlas(),
    atlasBusy,
  };

  /** Imports an SPM / CAT12 y_*.nii as the normalization of the selected subject. */
  async function importDeformationField(file: File) {
    const S = normSubject;
    if (!S) return;
    setNormError(null);
    setFieldStatus(tx("Wird gelesen …"));
    try {
      let buffer = await file.arrayBuffer();
      const head = new Uint8Array(buffer, 0, 2);
      if (head[0] === 0x1f && head[1] === 0x8b) buffer = await decompressGzip(buffer);
      const parsed = parseDeformationField(buffer);
      const coverage = fieldCoverage(parsed.field, S.dataset.current);
      if (coverage < 0.3) {
        setFieldStatus(null);
        setNormError(
          tx("Das Feld zeigt nur zu {v} % in das Bild von „{displayName}“. Falsches Subjekt, ein inverses Feld (iy_*.nii statt y_*.nii) oder ein anders orientiertes Bild?", { v: Math.round(coverage * 100), displayName: S.dataset.displayName }),
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
        tx("{name}: {nx} × {ny} × {nz}, {v} mm; {v2} % im Bild des Subjekts", { name: file.name, nx, ny, nz, v: geometry.spacing.map((v) => v.toFixed(2)).join(" × "), v2: Math.round(coverage * 100) }) +
          (parsed.invalidFraction > 0 ? tx(", {v} % ohne Zuordnung", { v: (parsed.invalidFraction * 100).toFixed(1) }) : "") +
          (tpl ? tx(" – passt zur Vorlage {name}.", { name: tpl.dataset.template?.name }) : tx(" – Raster weicht von den geladenen Vorlagen ab; die übertragenen Datensätze bilden den Standardraum.")),
      );
      await transferToStandardSpace(n, [S.id], "linear", tpl);
    } catch (e) {
      setFieldStatus(null);
      setNormError(tx("Verformungsfeld nicht lesbar: {v}", { v: e instanceof Error ? e.message : String(e) }));
    }
  }

  function exportDeformationField() {
    if (!normFor) return;
    const subject = byId(normFor.subjectId);
    const bytes = buildDeformationField(normFor);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = withPatientId(`y_${(subject?.dataset.displayName ?? "subject").replace(/\.nii(\.gz)?$/i, "").replace(/[äöüÄÖÜß]/g, umlaut).replace(/[^A-Za-z0-9_.-]+/g, "_")}.nii`);
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
        const label = `${i + 1}/${ids.length}: ${entryShort(e)}`;
        setTransferStatus(tx("{label} wird übertragen …", { label }));
        // Label images keep their label numbers (nearest neighbour) and region names.
        const m: Interpolation = e.dataset.atlas ? "nearest" : method;
        const data = await runResample(e.dataset.current, w2v, points, m, (f) => setTransferStatus(`${label} ${Math.round(f * 100)} %`));
        const vol = tpl ? tpl.dataset.current.withData(data) : new Volume3D(data, nz, ny, nx, [geometry.spacing[2], geometry.spacing[1], geometry.spacing[0]], geometry);
        // Dynamic data: every frame with the same transformation (kinetic modelling in the standard space).
        let dynamic = e.dataset.dynamic;
        if (dynamic) {
          const frames: Float32Array[] = [];
          for (const [k, f] of dynamic.frames.entries()) {
            setTransferStatus(tx("{label}: Frame {v}/{length}", { label, v: k + 1, length: dynamic.frames.length }));
            frames.push(await runResample(e.dataset.current.withData(f), w2v, points, m));
          }
          dynamic = { ...dynamic, frames };
        }
        const source = tpl?.dataset.source.kind === "nifti" ? tpl.dataset.source : ({ kind: "reconstruction" } as const);
        const d = createDataset(vol, source, `${e.dataset.displayName} · ${n.templateName}`);
        const derived: LoadedDataset = {
          ...d,
          ...(e.dataset.atlas ? { atlas: e.dataset.atlas } : {}),
          ...(e.dataset.kindLabel ? { kindLabel: e.dataset.kindLabel } : {}),
          ...(e.dataset.valueUnit ? { valueUnit: e.dataset.valueUnit } : {}),
          ...(dynamic ? { dynamic } : {}),
          derivedFrom: { name: e.dataset.displayName, source: unitSource(e.dataset), space: n.templateName, sourceId: e.id },
        };
        created.push({ id: `ds${nextEntryId++}`, dataset: derived, display: { ...e.display, opacity: 1, visible: true }, matrix: IDENTITY_MAT4, tag: e.tag, labelFilter: e.labelFilter });
      }
      // A new transfer replaces older copies of the same datasets in the same standard space.
      const replaced = new Set(entries.filter((x) => x.dataset.derivedFrom?.sourceId && ids.includes(x.dataset.derivedFrom.sourceId) && x.dataset.derivedFrom.space === n.templateName && !x.dataset.derivedFrom.label).map((x) => x.id));
      if (replaced.size) setEntries((prev) => prev.filter((x) => !replaced.has(x.id)));
      // Switch the display to the standard space.
      if (tpl) {
        const inv = invert4(tpl.matrix);
        setEntries((prev) => [...prev.map((x) => ({ ...x, matrix: x.id === tpl.id ? IDENTITY_MAT4 : multiply4(inv, x.matrix) })), ...created]);
        setReferenceId(tpl.id);
      } else if (created.length) {
        setEntries((prev) => [...prev, ...created]);
        setReferenceId((created.find((c) => isAnatomical(unitSource(c.dataset))) ?? created[0]).id);
      }
      const overlayEntry = created.find((c) => !c.dataset.atlas && !c.dataset.dynamic && !isAnatomical(unitSource(c.dataset))) ?? created.find((c) => !c.dataset.atlas) ?? created[0];
      if (overlayEntry) {
        // New space: the previous overlays (native space) are replaced by the transferred dataset.
        setOverlayIds([overlayEntry.id]);
        setEntries((prev) => prev.map((x) => (x.id === overlayEntry.id ? { ...x, display: overlayDisplay(x) } : x)));
      }
      setCursor(null);
      setTransferStatus(tx("{length} Datensatz/Datensätze im Standardraum angelegt ({nx} × {ny} × {nz}).", { length: created.length, nx, ny, nz }));
      return created;
    } catch (e) {
      setTransferStatus(null);
      setNormError(tx("Übertragung fehlgeschlagen: {v}", { v: e instanceof Error ? e.message : String(e) }));
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
      { label: tx("Auto"), window: defaultDisplay(v, e.dataset.source).window },
      ...(suv?.ok ? [5, 10, 15].map((m) => ({ label: `SUV 0–${m}`, window: [0, m / suv.info.factor] as [number, number] })) : []),
    ];
  };

  // Manual registration of the moving dataset relative to the reference: parameters about its center or about the
  // selected landmark (its "origin").
  const movingLandmark = moving?.landmarks?.find((l) => l.name === LANDMARK_1);
  const movingCenter = moving ? (rotPivot === "landmark" && movingLandmark ? movingLandmark.p : centerOf(moving.dataset.current)) : null;
  const movingParams = moving && movingCenter ? (paramsFromMatrix(moving.matrix, movingCenter) ?? IDENTITY_PARAMS) : IDENTITY_PARAMS;

  // ── Landmarks / origin ──
  const sameFrame = (a: Entry, b: Entry) => {
    const fa = a.dataset.current.geometry.frameOfReferenceUid, fb = b.dataset.current.geometry.frameOfReferenceUid;
    return !!fa && fa === fb && a.id !== b.id;
  };
  const nativeOf = (e: Entry, p: Vec3): Vec3 => applyMat4(invert4(e.matrix), p);
  const sideEntry = (side: LandmarkSide) => (side === "base" ? reference : moving);
  const placementMismatch = (() => {
    if (!moving || !reference) return false;
    const box = (e: Entry) => gridBox(transformGeometry(e.dataset.current.geometry, e.matrix), [e.dataset.current.nx, e.dataset.current.ny, e.dataset.current.nz]);
    return boxOverlap(box(moving), box(reference)) < 0.1;
  })();

  /** New placement of the moving dataset; datasets of the same acquisition follow (same relative pose). */
  function placeMoving(next: Mat4) {
    if (!moving) return;
    makeOverlay(moving.id);
    setMatrixGroup(moving.id, next);
    setEntries((prev) => prev.map((x) => (x.id === moving.id ? { ...x, display: { ...x.display, visible: true } } : x)));
    discardResultOnly(moving.id);
  }

  const landmarkWorld = (e: Entry, name: string) => {
    const l = e.landmarks?.find((x) => x.name === name);
    return l ? applyMat4(e.matrix, l.p) : null;
  };

  /** Landmark mode: the viewer shows only one dataset; the cross-hair goes to its landmark 1 or its center. */
  function showLandmarkSide(side: LandmarkSide) {
    const e = sideEntry(side);
    if (!e) return;
    setLandmarkView(side);
    if (moving) makeOverlay(moving.id);
    setCursor(landmarkWorld(e, LANDMARK_1) ?? applyMat4(e.matrix, centerOf(e.dataset.current)));
  }

  function setLandmarkMode2(on: boolean) {
    setLandmarkMode(on);
    // Keep the landmark tab open while working there (the default tab follows the overlap otherwise).
    if (on && moving) setAlignTabFor({ id: moving.id, tab: "landmarks" });
    if (on) showLandmarkSide("base");
    else if (moving) {
      makeOverlay(moving.id);
      updateEntry(moving.id, { display: { ...overlayDisplay(moving), visible: true } });
    }
  }

  function setLandmark(name: string) {
    const e = sideEntry(landmarkView);
    if (!e) return;
    const p = nativeOf(e, cursor ?? applyMat4(e.matrix, centerOf(e.dataset.current)));
    updateEntry(e.id, { landmarks: [...(e.landmarks ?? []).filter((l) => l.name !== name), { name, p }] });
  }

  /** After an alignment: leave the landmark mode, show both datasets and put the cross-hair on landmark 1. */
  function showAlignment(next: Mat4, message: string) {
    if (!moving || !reference) return;
    placeMoving(next);
    setLandmarkMode(false);
    setRotPivot("landmark");
    setCoregSettings((s) => ({ ...s, keepStart: true }));
    const b1 = landmarkWorld(reference, LANDMARK_1);
    if (b1) setCursor(b1);
    setLandmarkStepFor({ id: moving.id, step: message.includes("gedreht") ? 2 : 1 });
    setAlignTabFor({ id: moving.id, tab: "landmarks" });
    setNotice(message);
  }

  function originToLandmark1() {
    if (!moving || !reference) return;
    const b1 = landmarkWorld(reference, LANDMARK_1);
    const m1 = moving.landmarks?.find((l) => l.name === LANDMARK_1);
    if (!b1 || !m1) return;
    const before = applyMat4(moving.matrix, m1.p);
    const dist = Math.hypot(b1[0] - before[0], b1[1] - before[1], b1[2] - before[2]);
    showAlignment(
      alignByLandmark(b1, m1.p, moving.matrix),
      tx("{v} um {v2} mm verschoben: Landmarke 1 liegt jetzt auf Landmarke 1 der Basis (Fadenkreuz). Falls verdreht: „Mit Landmarke 2 ausrichten“ oder im Reiter „Manuell“ um Landmarke 1 drehen.", { v: entryLabel(moving), v2: dist.toFixed(0) }),
    );
  }

  function alignWithLandmark2() {
    if (!moving || !reference) return;
    const b1 = landmarkWorld(reference, LANDMARK_1), b2 = landmarkWorld(reference, LANDMARK_2);
    const m1 = moving.landmarks?.find((l) => l.name === LANDMARK_1), m2 = moving.landmarks?.find((l) => l.name === LANDMARK_2);
    if (!b1 || !b2 || !m1 || !m2) return;
    const next = alignTwoLandmarks(b1, b2, m1.p, m2.p, moving.matrix);
    if (!next) return;
    // Rotation angle between the old and new linear part.
    const A = moving.matrix, B = next;
    let tr = 0;
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tr += B[i * 4 + k] * A[i * 4 + k];
    const angle = (Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180) / Math.PI;
    const db = Math.hypot(b2[0] - b1[0], b2[1] - b1[1], b2[2] - b1[2]);
    const dm = Math.hypot(m2.p[0] - m1.p[0], m2.p[1] - m1.p[1], m2.p[2] - m1.p[2]);
    showAlignment(
      next,
      tx("{v} auf Landmarke 1 gelegt und um {v2}° gedreht, bis die Richtung zu Landmarke 2 stimmt. Abstand Landmarke 1–2: Basis {v3} mm, Datensatz {v4} mm{v5}.", { v: entryLabel(moving), v2: angle.toFixed(0), v3: db.toFixed(0), v4: dm.toFixed(0), v5: Math.abs(db - dm) > 10 ? tx(" – deutlich verschieden, Landmarken prüfen") : "" }),
    );
  }

  /** Takes the coordinate change T into the datasets `ids`; all placements are compensated (see reorientPlan). */
  function applyReorient(ids: Set<string>, T: Mat4) {
    if (!reference) return;
    const r = reorientPlan(entries.map((e) => ({ id: e.id, matrix: e.matrix, geometry: e.dataset.current.geometry, landmarks: e.landmarks })), ids, T, reference.id);
    const move = (v: Volume3D) => new Volume3D(v.data, v.nz, v.ny, v.nx, v.voxelSpacingMm, transformGeometry(v.geometry, T));
    setEntries((prev) =>
      prev.map((e) => {
        const matrix = r.matrices.get(e.id) ?? e.matrix;
        if (!ids.has(e.id)) return { ...e, matrix };
        const prevT = e.dataset.reoriented ?? IDENTITY_MAT4;
        const total = multiply4(T, prevT);
        const isIdentity = total.every((v, i) => Math.abs(v - IDENTITY_MAT4[i]) < 1e-9);
        const original = move(e.dataset.original);
        const current = e.dataset.current === e.dataset.original ? original : move(e.dataset.current);
        return { ...e, matrix, landmarks: r.landmarks.get(e.id) ?? e.landmarks, dataset: { ...e.dataset, original, current, reoriented: isIdentity ? undefined : total } };
      }),
    );
    if (cursor) setCursor(applyMat4(r.world, cursor));
    setVoi(null);
    setCoregResults({});
  }

  function reorientTo(side: LandmarkSide, sameFrameToo: boolean) {
    const e = sideEntry(side);
    const l = e?.landmarks?.find((x) => x.name === LANDMARK_1);
    if (!e || !l) return;
    const ids = new Set([e.id, ...(sameFrameToo && isPrimary(e) ? membersOf(e.id).map((x) => x.id) : [])]);
    if (!window.confirm(tx("Ursprung (0,0,0) von {what} auf Landmarke 1 legen? Die Lage zu den anderen Datensätzen bleibt erhalten.", { what: ids.size === 1 ? "„" + entryLabel(e) + "“" : tx("{n} Datensätzen", { n: ids.size }) }))) return;
    applyReorient(ids, originShift(l.p));
  }

  function resetOrigin(side: LandmarkSide) {
    const e = sideEntry(side);
    if (!e?.dataset.reoriented) return;
    const key = JSON.stringify(e.dataset.reoriented);
    const ids = new Set([e.id, ...entries.filter((x) => sameFrame(x, e) && JSON.stringify(x.dataset.reoriented) === key).map((x) => x.id)]);
    applyReorient(ids, invert4(e.dataset.reoriented));
  }

  let frameNote: string | undefined;
  if (moving && reference) {
    const a = moving.dataset.current.geometry.frameOfReferenceUid;
    const b = reference.dataset.current.geometry.frameOfReferenceUid;
    if (!moving.dataset.current.hasPatientGeometry || !reference.dataset.current.hasPatientGeometry)
      frameNote = tx("Für mindestens einen Datensatz sind keine Patientenkoordinaten bekannt – vorher über Landmarken oder manuell grob ausrichten.");
    else if (a && b && a !== b)
      frameNote = tx("Unterschiedliche Frame-of-Reference-UIDs: Die Datensätze stammen evtl. aus verschiedenen Untersuchungen – Grobsuche empfohlen.");
  }

  /** NIfTI: user-chosen modality; switching to/from CT also switches between CT and automatic window. */
  /** Modality chosen in the dataset details (undefined = automatic); switching to/from CT also switches the window. */
  function setModality(id: string, modality: string | undefined) {
    const e = byId(id);
    if (!e) return;
    const dataset: LoadedDataset = { ...e.dataset, source: { ...e.dataset.source, modality } as VolumeSource };
    const wasCt = modalityLabel(e.dataset.source) === "CT";
    const isCt = modalityLabel(dataset.source) === "CT";
    const display = wasCt === isCt ? e.display : { ...e.display, window: defaultDisplay(dataset.current, dataset.source).window };
    updateEntry(id, { dataset, display });
  }

  /** New dataset name (part of export file names); empty = name on loading. */
  function renameDataset(id: string, name: string) {
    const e = byId(id);
    if (!e) return;
    const originalName = e.dataset.originalName ?? e.dataset.displayName;
    const displayName = name || originalName;
    const derivedFrom = e.dataset.derivedFrom && !e.dataset.derivedFrom.label ? { ...e.dataset.derivedFrom, name: displayName } : e.dataset.derivedFrom;
    updateEntry(id, { dataset: { ...e.dataset, displayName, originalName, ...(derivedFrom ? { derivedFrom } : {}) } });
  }

  const dataTab = (
    <>
      <VolumeUploadPanel
        title={entries.length ? tx("Weiteren Datensatz laden") : tx("Volumen laden")}
        onLoaded={handleVolumeLoaded}
        onProjectFile={(f) => void openProjectFile(f)}
        onBusyChange={(b) => {
          setLoadBusy(b);
          if (b) loadDecisions.current = [];
          else {
            const d = loadDecisions.current;
            const hidden = d.filter((x) => !x.shown);
            if (hidden.length)
              setNotice(
                tx("{length} {v} geladen – nicht eingeblendet: {v2}. Einblenden über „Ebenen“ oben rechts im Viewer.", { length: d.length, v: d.length === 1 ? "Datensatz" : tx("Datensätze"), v2: hidden.map((h) => h.name).join(", ") }),
              );
          }
        }}
        description={tx("PET, SPECT, CT oder MRT als DICOM (Datei oder Serie) bzw. NIfTI – beliebig viele.")}
        compact={entries.length > 0}
      />
      <section className="card patient-card">
        <label className="field">
          {tx("Patient-ID")}
          <input type="text" value={patientId} maxLength={64} placeholder="optional, z. B. P0815" onChange={(e) => setPatientId(e.target.value)} />
        </label>
        <InfoText details={tx("Wird allen exportierten NIfTI- und CSV-Dateinamen vorangestellt (auch in ZIP-Archiven solcher Dateien) sowie dem Namen der Projektdatei (.recon); DICOM-Exporte bleiben unverändert. Wird im Projekt mitgespeichert.")}>
          {sanitizePatientId(patientId) ? tx("Präfix „{v}_“", { v: sanitizePatientId(patientId) }) : tx("Präfix für Exportnamen")}
        </InfoText>
      </section>
      {entries.length > 0 && (
        <DatasetList
          rows={entries.map((e) => {
            const isOverlay = overlays.some((o) => o.id === e.id);
            return {
              id: e.id,
              modality: datasetModality(e.dataset),
              name: middleEllipsis(shortName(e.dataset.displayName), 40),
              title: entryLabel(e),
              tag: e.tag,
              isBase: e.id === reference?.id,
              isShown: e.id === reference?.id || (isOverlay && e.display.visible),
              isActive: e.id === active?.id,
              notes: [...(e.dataset.dynamic ? ["dyn."] : []), ...(e.dataset.edits.length ? ["bearb."] : [])],
              date: ((a) => a && { short: formatAcquisitionTime(a, true), full: formatAcquisitionTime(a) })(acquisitionTime(e.dataset)),
            };
          })}
          details={(id) => {
            const e = byId(id);
            return (
              e && (
                <DatasetDetails
                  dataset={e.dataset}
                  onModalityChange={(m) => setModality(e.id, m)}
                  onNameChange={(n) => renameDataset(e.id, n)}
                  originalName={e.dataset.originalName}
                  isBase={e.id === reference?.id}
                  onMakeBase={entries.length > 1 ? () => changeBase(e.id) : undefined}
                >
                  <TagInput value={e.tag ?? ""} onChange={(t) => updateEntry(e.id, { tag: t || undefined })} />
                </DatasetDetails>
              )
            );
          }}
          onToggleShown={(id) => {
            const e = byId(id);
            if (!e || id === reference?.id) return;
            if (!overlays.some((o) => o.id === id)) makeOverlay(id);
            else updateEntry(id, { display: { ...e.display, visible: !e.display.visible } });
          }}
          onActivate={switchActive}
          onMakeBase={makeReference}
          onRemove={removeEntry}
        />
      )}
      {projectCard}
      <input
        ref={projectInput}
        type="file"
        hidden
        accept={`${PROJECT_EXTENSION},.zip`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openProjectFile(f);
          e.target.value = "";
        }}
      />
      <details className="card collapsible">
        <summary>{tx("Vorlagen & Atlanten (Hirn, MNI)")}</summary>
        <BrainCatalog
          loaded={loadedCatalog}
          busyId={catalogBusy}
          onLoad={(id) => void (bundledEntry(id)?.group === "atlas" ? addBundledAtlas(id) : addCatalogEntry(id))}
          onUserFiles={(f) => void addUserCatalogFiles(f)}
          cached={cachedCatalog}
          onLoadCached={(id) => void loadCachedCatalog(id)}
          onRemoveCached={(id) => void removeCachedEntry(id).then(() => cachedEntryIds().then(setCachedCatalog))}
          error={catalogError}
        />
        <p className="hint">{tx("Eigene Vorlagen:")}</p>
        <VolumeUploadPanel single title={tx("Eigene T1-Vorlage (NIfTI)")} description={tx("z. B. aus SPM oder CAT12.")} onLoaded={(l, n) => addOwnTemplate(l, n, "T1")} />
        <label className="field">
          {tx("Eigene PET-Vorlage (NIfTI; 4D = adaptive Vorlage: amyloid-negativ, amyloid-positiv)")}
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
        <summary>{tx("SPECT-Rohdaten rekonstruieren")}</summary>
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
        title={`${entryLabel(e)}${isOverlay ? ` · Overlay ${overlays.length > 1 ? overlays.length - index : ""}` : overlays.length ? ` · ${tx("Basis")}` : ""}`}
        display={isOverlay ? e.display : { ...e.display, opacity: 1 }}
        onChange={(d) => updateEntry(e.id, { display: d })}
        scale={u.scale}
        unitLabel={u.label}
        presets={presetsFor(e)}
        showOpacity={isOverlay}
        showVisibility={overlays.length > 0}
      >
        <TagInput value={e.tag ?? ""} onChange={(t) => updateEntry(e.id, { tag: t || undefined })} />
        {e.dataset.dynamic && (
          <FrameSlider
            dynamic={e.dataset.dynamic}
            frame={e.frame}
            autoWindow={e.frameAutoWindow ?? true}
            onAutoWindowChange={(on) => updateEntry(e.id, { frameAutoWindow: on })}
            onFrameChange={(f) => {
              const dyn = e.dataset.dynamic!;
              const auto = e.frameAutoWindow ?? true;
              const win = auto ? frameWindow(f === undefined ? e.dataset.current.data : dyn.frames[f]) : undefined;
              setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, frame: f, display: win ? { ...x.display, window: win } : x.display } : x)));
            }}
          />
        )}
        {e.dataset.atlas && labelList(e)}
        {isOverlay && (
          <div className="chip-row">
            <button className="chip-btn" disabled={index === 0} title={tx("eine Ebene nach oben")} onClick={() => moveOverlay(e.id, 1)}>
              {tx("↑ nach oben")}
            </button>
            <button className="chip-btn" disabled={index === overlays.length - 1} title={tx("eine Ebene nach unten")} onClick={() => moveOverlay(e.id, -1)}>
              {tx("↓ nach unten")}
            </button>
            <button className="chip-btn" onClick={() => makeReference(e.id)}>
              {tx("als Basis")}
            </button>
            <button className="chip-btn" onClick={() => removeOverlay(e.id)}>
              {tx("aus Ansicht entfernen")}
            </button>
          </div>
        )}
      </LayerSettings>
    );
  };

  const overviewVoi = useStableVoi(
    voiMaskData && volume && activeW2v && voi && active
      ? { mask: voiMaskData, volume, w2v: activeW2v, bounds: voiBounds, label: tx("VOI ({v}) auf {v2}", { v: voi.shape.kind === "sphere" ? tx("Kugel") : voi.shape.kind === "box" ? tx("Quader") : tx("gezeichnet"), v2: datasetModality(active.dataset) }) }
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
        <Card title={<>{tx("Weitere Datensätze")}</>} status={{ text: String(hiddenEntries.length), tone: "info" }}>
          {hiddenEntries.map((e) => (
            <div key={e.id} className="hidden-dataset-row">
              <span>{entryLabel(e)}</span>
              <button className="chip-btn" onClick={() => makeOverlay(e.id)}>
                {tx("als Overlay einblenden")}
              </button>
            </div>
          ))}
        </Card>
      )}
      {reference && (
        <FusionExportCard
          layerLabels={visibleStack.map((e) => entryShort(e))}
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
  const overlapsBase = (x: Entry) => {
    if (!reference) return true;
    const box = (y: Entry) => gridBox(transformGeometry(y.dataset.current.geometry, y.matrix), [y.dataset.current.nx, y.dataset.current.ny, y.dataset.current.nz]);
    return boxOverlap(box(x), box(reference)) >= 0.1;
  };
  const statusOf = (e: Entry): RegStatusKind => {
    const r = coregResults[e.id];
    return regQueue.running === e.id ? "running" : regQueue.waiting.includes(e.id) ? "queued" : r && !r.accepted ? "pending" : r ? "registered" : isIdentity(e.matrix) ? "scanner" : "manual";
  };
  const regRows: RegRow[] = regCandidates.map((e) => {
    const r = coregResults[e.id];
    const status = statusOf(e);
    const detail =
      status === "running" && coregProgress
        ? tx("Stufe {level}/{levels} · {v}", { level: coregProgress.level, levels: coregProgress.levels, v: similarity(coregSettings.cost === "auto" ? costFor(e) : coregSettings.cost, coregProgress.cost) })
        : r && (status === "pending" || status === "registered")
          ? `${similarity(r.result.cost, r.result.before)} → ${similarity(r.result.cost, r.result.after)}`
          : undefined;
    return {
      id: e.id,
      label: entryLabel(e),
      info: gridInfo(e),
      status,
      detail,
      passive: isPassive(e),
      mismatch: !overlapsBase(e),
      members: membersOf(e.id).map((m) => ({ id: m.id, label: entryLabel(m) })),
    };
  });
  // "Ausrichten": groups first, then single members.
  const alignTargets = [
    ...regCandidates.map((e) => ({ id: e.id, label: entryLabel(e) })),
    ...movingCandidates.filter((e) => !isPrimary(e)).map((e) => ({ id: e.id, label: entryLabel(e), single: true })),
  ];
  const alignTab: AlignTab = moving && alignTabFor?.id === moving.id ? alignTabFor.tab : placementMismatch ? "landmarks" : "auto";
  const setAlignTab = (tab: AlignTab) => {
    if (!moving) return;
    setAlignTabFor({ id: moving.id, tab });
    if (tab !== "landmarks" && landmarkMode) setLandmarkMode2(false);
  };
  const landmarkStep = moving && landmarkStepFor?.id === moving.id ? landmarkStepFor.step : 0;
  const movingStatus = moving ? statusOf(moving) : null;
  const STATUS_TEXT: Record<RegStatusKind, string> = { scanner: tx("Patientenkoordinaten"), registered: tx("✓ registriert"), manual: tx("✎ manuell/Landmarken"), pending: tx("◐ Ergebnis prüfen"), running: tx("läuft …"), queued: tx("wartet") };

  /** Datasets that can be edited (VOI, values): all except standard-space templates. */
  const editTargets = entries.filter((e) => !e.dataset.template).map((e) => ({ id: e.id, label: entryLabel(e) }));

  const registrationTab = reference && (
    <>
      <RegistrationSetup
        datasets={entries.map((e) => ({ id: e.id, label: entryLabel(e), info: `${datasetModality(e.dataset)} · ${gridInfo(e)}` }))}
        referenceId={reference.id}
        onReferenceChange={changeBase}
        baseMembers={membersOf(reference.id).map((m) => ({ id: m.id, label: entryLabel(m) }))}
        rows={regRows}
        selected={regSelection}
        onSelectedChange={setRegSelected}
        focusId={moving?.id ?? null}
        onFocus={selectMoving}
        running={coregRunning}
        progressText={
          regQueue.running
            ? `${shortLabel(entryLabel(byId(regQueue.running)!), 30)}${coregProgress ? ` · Stufe ${coregProgress.level}/${coregProgress.levels} · ${coregProgress.stage}` : ""}${regQueue.waiting.length ? ` · noch ${regQueue.waiting.length} wartend` : ""}`
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
        <AlignCard
          targets={alignTargets}
          targetId={moving.id}
          onTargetChange={selectMoving}
          tab={alignTab}
          onTabChange={setAlignTab}
          mismatch={placementMismatch}
          status={movingStatus ? { text: STATUS_TEXT[movingStatus], tone: movingStatus === "registered" ? "ok" : movingStatus === "pending" ? "warn" : "info" } : null}
          landmarks={
            <LandmarkPanel
              baseLabel={entryLabel(reference)}
              movingLabel={entryLabel(moving)}
              baseLandmarks={reference.landmarks ?? []}
              movingLandmarks={moving.landmarks ?? []}
              mode={landmarkMode}
              onModeChange={setLandmarkMode2}
              view={landmarkView}
              onViewChange={showLandmarkSide}
              onSet={setLandmark}
              onGoTo={(side, name) => {
                const e = sideEntry(side);
                const w = e ? landmarkWorld(e, name) : null;
                if (!w) return;
                if (landmarkMode) setLandmarkView(side);
                setCursor(w);
              }}
              onRemove={(side, name) => {
                const e = sideEntry(side);
                if (e) updateEntry(e.id, { landmarks: (e.landmarks ?? []).filter((l) => l.name !== name) });
              }}
              onOriginToLandmark1={originToLandmark1}
              onAlignWithLandmark2={alignWithLandmark2}
              step={landmarkStep}
              onNext={() => setAlignTab("auto")}
              running={coregRunning}
            />
          }
          auto={
            <>
              {frameNote && <p className="tool-hint">{frameNote}</p>}
              <CoregSettingsForm autoCost={autoCost} settings={coregSettings} onSettingsChange={setCoregSettings} running={coregRunning} />
              {!coregRunning ? (
                <button className={movingStatus === "pending" ? "secondary-btn" : "primary-btn"} onClick={() => void startCoregistration([moving.id])}>
                  {tx("Jetzt registrieren")}
                </button>
              ) : (
                <>
                  <p className="tool-hint">
                    {coregProgress ? tx("Stufe {level}/{levels} · {stage}", { level: coregProgress.level, levels: coregProgress.levels, stage: coregProgress.stage }) : tx("Vorbereitung …")}
                  </p>
                  <button
                    className="secondary-btn"
                    onClick={() => {
                      regCancelled.current = true;
                      coregRun.current?.cancel();
                    }}
                  >
                    {tx("Abbrechen")}
                  </button>
                </>
              )}
              {movingStatus === "pending" && coregResults[moving.id] && (
                <>
                  <p className="tool-hint">
                    Ergebnis: {similarity(coregResults[moving.id].result.cost, coregResults[moving.id].result.before)} →{" "}
                    {similarity(coregResults[moving.id].result.cost, coregResults[moving.id].result.after)}. Die Ansicht zeigt es bereits.
                  </p>
                  <div className="button-row">
                    <button className="primary-btn" onClick={() => acceptCoregistration(moving.id)}>
                      {tx("Übernehmen")}
                    </button>
                    <button className="secondary-btn" onClick={() => discardCoregistration(moving.id)}>
                      {tx("Verwerfen")}
                    </button>
                  </div>
                </>
              )}
            </>
          }
          manual={
            <RegistrationPanel
              params={movingParams}
              onChange={(p) => placeMoving(matrixFromParams(p, movingCenter))}
              pivots={movingLandmark ? [{ id: "landmark", label: tx("Landmarke 1 (Ursprung)") }, { id: "center", label: tx("Volumenmitte") }] : undefined}
              pivot={rotPivot}
              onPivotChange={(v) => setRotPivot(v as "landmark" | "center")}
            >
              {!isRigid(movingParams) && (
                <p className="tool-hint">
                  Affine Anteile: Skalierung {[movingParams.sx, movingParams.sy, movingParams.sz].map((v) => v.toFixed(3)).join(" / ")}, Scherung{" "}
                  {[movingParams.hxy, movingParams.hxz, movingParams.hyz].map((v) => v.toFixed(3)).join(" / ")}
                </p>
              )}
            </RegistrationPanel>
          }
          advanced={
            <>
              <div className="button-row">
                <button className="secondary-btn" disabled={coregRunning} onClick={saveMatrix}>
                  {tx("Matrix speichern")}
                </button>
                <label className="secondary-btn file-btn">
                  {tx("Matrix laden")}
                  <input
                    type="file"
                    accept=".json,application/json"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void loadMatrix(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <button
                className="secondary-btn"
                disabled={coregRunning}
                onClick={() => {
                  setMatrixGroup(moving.id, IDENTITY_MAT4);
                  discardResultOnly(moving.id);
                }}
              >
                {tx("Auf Patientenkoordinaten zurücksetzen")}
              </button>
              <InfoText details={tx("Wie SPM „Set origin“: Landmarke 1 wird zum Koordinatenursprung (0,0,0) des Datensatzes. Die Lage zu den anderen Datensätzen bleibt, der Export enthält den neuen Ursprung (DICOM als neue Serie mit neuer FrameOfReference). Gilt auch für die Datensätze derselben Aufnahme. Vor einer Normalisierung ausführen.")}>
                {tx("Ursprung dauerhaft übernehmen")}
              </InfoText>
              <div className="button-row">
                <button className="secondary-btn" disabled={coregRunning || !reference.landmarks?.some((l) => l.name === LANDMARK_1)} onClick={() => reorientTo("base", true)}>
                  Basis: Ursprung = Landmarke 1
                </button>
                <button className="secondary-btn" disabled={coregRunning || !moving.landmarks?.some((l) => l.name === LANDMARK_1)} onClick={() => reorientTo("moving", true)}>
                  Datensatz: Ursprung = Landmarke 1
                </button>
              </div>
              {(["base", "moving"] as LandmarkSide[]).map((side) =>
                sideEntry(side)?.dataset.reoriented ? (
                  <p key={side} className="tool-hint">
                    {side === "base" ? "Basis" : "Datensatz"}: Ursprung übernommen.{" "}
                    <button className="link-btn" disabled={coregRunning} onClick={() => resetOrigin(side)}>
                      {tx("zurück auf Original-Ursprung")}
                    </button>
                  </p>
                ) : null,
              )}
              <InfoText details={tx("Intensitätsbasierte Registrierung nach dem Vorbild von SPM (Coregister) und FSL FLIRT: Mutual Information für unterschiedliche Modalitäten, Kreuzkorrelation für gleiche; Startpunkt ist die aktuelle Lage (Patientenkoordinaten, Landmarken oder manuelle Korrektur). Grobsuche: Schwerpunkt + Rotationsraster ±30°; Startlage beibehalten: nur ±10° / ±10 mm.")}>
                {tx("Wie funktioniert die Registrierung?")}
              </InfoText>
            </>
          }
        />
      )}
    </>
  );


  const normalizationTab = (
    <NormalizationPanel
      templates={templateOptions}
      templateId={normTemplateChoice}
      onTemplateChange={setNormTemplateId}
      subjects={subjectCandidates.map((e) => ({ id: e.id, label: entryLabel(e) }))}
      subjectId={normSubject?.id ?? null}
      onSubjectChange={(id) => {
        setNormSubjectId(id);
        setNormSubjectKindOverride(null);
        setNormTemplateId(null);
      }}
      subjectKind={subjectKind}
      onSubjectKindChange={(k) => {
        setNormSubjectKindOverride(k);
        setNormTemplateId(null);
      }}
      method={sameContrast ? normMethod : "affine"}
      onMethodChange={setNormMethod}
      nonlinearAvailable={sameContrast}
      regularization={normRegularization}
      onRegularizationChange={setNormRegularization}
      outputGrid={normOutput}
      onOutputGridChange={setNormOutput}
      templateResolutionMm={normTemplate ? normTemplate.dataset.current.geometry.spacing[0] : bundledEntry(normTemplateChoice.replace(/^bundled:/, ""))?.resolutionMm}
      useMask={normUseMask}
      onUseMaskChange={setNormUseMask}
      maskAvailable={subjectKind !== "CT" && (normTemplate ? !!normTemplate.dataset.template?.mask : templateKind !== "CT")}
      costLabel={normCost === "ncc" ? tx("Kreuzkorrelation (gleicher Kontrast)") : tx("Normalisierte Mutual Information (unterschiedlicher Kontrast)")}
      running={normRunning}
      progress={normProgress}
      onStart={startNormalization}
      onCancel={() => normRun.current?.cancel()}
      normalization={normFor}
      transferCandidates={patientSpaceEntries.map((e) => ({ id: e.id, label: entryLabel(e) }))}
      transferred={normFor ? entries.filter((e) => e.dataset.derivedFrom?.space === normFor.templateName && !e.dataset.derivedFrom.label).map((e) => ({ id: e.id, label: entryLabel(e) })) : []}
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
    </NormalizationPanel>
  );

  const suvrTab = (
    <>
      <CentiloidPanel
        voisLoaded={
          centiloidVois
            ? tx("VOIs geladen ({resolutionMm} mm): {v}", { resolutionMm: centiloidVois.resolutionMm, v: Object.keys(centiloidVois.volumes)
                .map((k) => tx(VOI_LABELS[k as VoiName]))
                .join(", ") })
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
        gmLoaded={loadedCatalog.has("mni-gm-1")}
        onLoadGm={() => void addCatalogEntry("mni-gm-1")}
        onCreateSuvrImage={createSuvrImage}
        error={atlasError}
      />
    </>
  );

  const tabs: ShellTab[] = [
    { id: "data", label: tx("Daten"), icon: FolderOpen, content: dataTab, badge: entries.length > 1 ? entries.length : undefined },
    { id: "view", label: tx("Ansicht"), icon: Eye, disabled: layers.length === 0, disabledReason: tx("Erst einen Datensatz laden"), content: viewTab },
    { id: "registration", label: tx("Koregistrierung (Patientenraum)"), shortLabel: tx("Ko\u00adregis\u00adtrierung"), icon: Crosshair, disabled: entries.length < 2, disabledReason: tx("Koregistrierung ab zwei Datensätzen"), content: registrationTab },
    {
      id: "normalization",
      label: tx("Standardraum (MNI, Hirn)"),
      shortLabel: tx("Standard\u00adraum"),
      icon: Brain,
      disabled: entries.filter((e) => !e.dataset.template).length === 0,
      disabledReason: tx("Erst einen Datensatz laden"),
      content: normalizationTab,
    },
    {
      id: "suvr",
      label: tx("Centiloid & SUVR"),
      shortLabel: "SUVR",
      icon: Gauge,
      disabled: entries.filter((e) => !e.dataset.template).length === 0,
      disabledReason: tx("Erst einen Datensatz laden"),
      content: suvrTab,
    },
    {
      id: "kinetics",
      label: tx("Kinetik"),
      icon: Activity,
      disabled: !entries.some((e) => e.dataset.dynamic),
      disabledReason: tx("Nur für dynamische Daten (4D-NIfTI oder dynamische DICOM-Serie)"),
      content: <KineticsPanel api={kineticsApi} />,
    },
    {
      id: "dosimetry",
      label: tx("Dosimetrie"),
      shortLabel: tx("Dosi\u00admetrie"),
      icon: Radiation,
      disabled: !entries.some((e) => !e.dataset.atlas && !e.dataset.template && !isAnatomical(e.dataset.source)),
      disabledReason: tx("Erst SPECT-Daten laden"),
      content: <DosimetryPanel api={dosimetryApi} />,
    },
    {
      id: "tumor",
      label: tx("Segmentierung & MTV"),
      shortLabel: tx("Segm. & MTV"),
      icon: Target,
      disabled: tumorTargets.length === 0 && ctEntries.length === 0,
      disabledReason: tx("Erst ein PET oder CT laden"),
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
        <SegBenchmarkCard
          cts={ctEntries.map((e) => ({ id: e.id, label: entryLabel(e) }))}
          references={entries.filter((e) => e.dataset.atlas).map((e) => ({ id: e.id, label: entryLabel(e) }))}
          running={benchRunning}
          progress={benchProgress}
          results={benchResults}
          runInfo={benchInfo}
          onRun={startSegBenchmark}
          onCancel={() => {
            benchCancel.current = true;
            ctSegRun.current?.cancel();
          }}
        />
        {organEntry?.dataset.atlas && (
          <Card title={<>Regionen · {entryLabel(organEntry)}</>} defaultOpen={false} persistKey="tumor-regions">
            <p className="tool-hint">{tx("Klick: Fadenkreuz in die Region · Häkchen: ein-/ausblenden.")}</p>
            {labelList(organEntry)}
          </Card>
        )}
        <TumorPanel
          targets={tumorTargets.map((e) => ({ id: e.id, label: entryLabel(e) }))}
          targetId={tumorEntry?.id ?? null}
          onTargetChange={setTumorTargetId}
          unitInfo={
            tumorSuv?.ok
              ? tx("Schwellen in SUV (Körpergewicht) aus dem DICOM-Header.")
              : tx("Kein SUV verfügbar{reason} – z. B. Therapie-SPECT in Counts. Schwellen gelten in der Einheit des Bildes ({unit}) oder relativ zum Maximum; feste SUV-Schwellen (2,5 / 3 / 4) sind dann nicht anwendbar. TLG/TL-PSMA ist das Produkt aus Volumen und mittlerem Wert in dieser Einheit.", { reason: tumorSuv && !tumorSuv.ok ? ` (${tx(tumorSuv.reason)})` : "", unit: tumorRawUnit || tx("Originalwerte") })
          }
          suvAvailable={!!tumorSuv?.ok}
          onAddLesionAtCursor={addLesionAtCursor}
          cursorSet={!!cursor}
          rawUnit={tumorRawUnit}
          rawMax={tumorRawMax}
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
          focusId={focusLesionId}
          onReview={reviewLesion}
          onCleanup={cleanupTumor}
          onExportCsv={exportTumorCsv}
          onExportNifti={exportTumorNifti}
          onClear={() => tumor?.datasetId ? removeEntry(tumor.datasetId) : setTumor(null)}
          indication={tumorIndication}
          onIndicationChange={setTumorIndication}
          organOptions={organEntries.map((e) => ({ id: e.id, label: entryLabel(e) }))}
          organId={organEntry?.id ?? null}
          onOrganChange={(id) => setTumorOrganId(id)}
          autoExclude={tumorAutoExclude}
          onAutoExcludeChange={setTumorAutoExclude}
          canAutoLiver={!!organEntry?.dataset.atlas && [...organEntry.dataset.atlas.labels.values()].some((n) => canonicalName(n) === "liver")}
          onAutoLiver={autoLiver}
          split={tumor && tumorIndication === "psma" && organEntry ? splitBurden(tumor.lesions) : null}
        />
        </>
      ),
    },
    {
      id: "analysis",
      label: tx("Analyse"),
      icon: BarChart3,
      disabled: !stats,
      disabledReason: tx("Erst einen Datensatz laden"),
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
          <Card title={<>Detailanalyse: {entryLabel(active)}</>}>
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
          </Card>
        </>
      ),
    },
    {
      id: "imcalc",
      label: tx("IMCALC – voxelweise Rechnung"),
      shortLabel: "IMCALC",
      icon: Calculator,
      disabled: imcalcInputs.length === 0,
      disabledReason: tx("Erst einen Datensatz laden"),
      content: (
        <>
        <ImcalcPanel
          datasets={imcalcInputs.map((e) => {
            const v = e.dataset.current;
            return {
              id: e.id,
              label: entryLabel(e),
              short: (e.tag || shortName(e.dataset.derivedFrom && !e.dataset.derivedFrom.label ? e.dataset.derivedFrom.name : e.dataset.displayName)).replace(/\s+/g, "_"),
              gridKey: gridKey(v.geometry, [v.nx, v.ny, v.nz]),
              gridInfo: `${v.nx}×${v.ny}×${v.nz}, ${v.geometry.spacing.map((x) => x.toFixed(2)).join("×")} mm`,
              unit: unitFor(e).label,
              dynamic: !!e.dataset.dynamic,
            };
          })}
          busy={!!imcalcBusy}
          status={imcalcStatus}
          error={imcalcError}
          results={imcalcResults.flatMap((id) => {
            const e = byId(id);
            return e ? [{ id, label: entryLabel(e) }] : [];
          })}
          onRun={(job) => void runImcalc(job)}
          onShow={(id) => {
            makeOverlay(id);
            setActiveId(id);
          }}
        />
        {dataset && volume && stats && (
          <>
            <ValueSection
              targets={editTargets}
              targetId={active?.id ?? ""}
              onTargetChange={switchActive}
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
            <HistorySection scale={scale} unitLabel={unitLabel} edits={dataset.edits} busy={editBusy} onUndo={handleUndo} onReset={handleReset} />
          </>
        )}
        </>
      ),
    },
    {
      id: "edit",
      label: tx("Bearbeiten"),
      icon: Wand2,
      disabled: !stats,
      disabledReason: tx("Erst einen Datensatz laden"),
      badge: dataset?.edits.length,
      content: dataset && volume && stats && (
        <>

          <VoiSection
            targets={editTargets}
            targetId={active?.id ?? ""}
            onTargetChange={switchActive}
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
          <TripleWindowCard
            cts={ctEntries.filter((e) => e.dataset.kindLabel !== "CT 3W").map((e) => ({ id: e.id, label: entryLabel(e) }))}
            organSets={organEntries.map((e) => ({ id: e.id, label: entryLabel(e), forCt: ctEntries.find((c) => tBoth("CT-Organe · {displayName}", { displayName: c.dataset.displayName }).includes(e.dataset.displayName))?.id }))}
            busy={tripleBusy}
            status={tripleStatus}
            error={tripleError}
            onRun={(r) => void createTripleWindow(r)}
          />
          <FilterSection busy={editBusy} onApply={handleApplyEdit} />
          <GeometrySection
            key={`${active?.id}:${volume.nx}x${volume.ny}x${volume.nz}`}
            volume={volume}
            targets={geometryTargets}
            activeId={active?.id ?? ""}
            busy={editBusy}
            onApply={(a, ids) => void handleGeometry(a, ids)}
          />
          <HistorySection scale={scale} unitLabel={unitLabel} edits={dataset.edits} busy={editBusy} onUndo={handleUndo} onReset={handleReset} />
          {error && <div className="error-banner">{error}</div>}
        </>
      ),
    },
    {
      id: "header",
      label: tx("Header"),
      icon: FileCode2,
      wide: true,
      disabled: dataset?.source.kind !== "dicom",
      disabledReason: tx("Header-Editor nur für DICOM-Datensätze (aktiver Datensatz)"),
      badge: dataset?.headerEdits.length,
      content: dataset && active && (
        <HeaderPanel key={active.id} dataset={dataset} onEditsChange={(headerEdits) => setDataset(active.id, { ...dataset, headerEdits })} />
      ),
    },
    {
      id: "export",
      label: tx("Export"),
      icon: Download,
      disabled: !dataset,
      disabledReason: tx("Erst einen Datensatz laden"),
      content: dataset && active && (
        <ExportPanel
          items={spaces.map((sp) => {
            const suv = suvById.get(sp.id);
            return { ...sp, suvFactor: suv?.ok ? suv.info.factor : null };
          })}
          activeId={active.id}
          onActivity={setExportActivity}
        />
      ),
    },
  ];

  const displayedIds = layers.map((l) => l.id);

  // ── Activity indicator: running jobs and errors, wherever they were started ──
  const activities: JobActivity[] = [];
  const act = (a: JobActivity | false | "" | null | undefined) => {
    if (a) activities.push(a);
  };
  act(projectBusy && { id: "project", label: projectBusy === "save" ? tx("Projekt speichern") : tx("Projekt öffnen"), tab: "data" });
  act(loadBusy && { id: "load", label: tx("Laden"), detail: tx("Dateien werden gelesen"), tab: "data" });
  act(busy && { id: "recon", label: tx("Rekonstruktion"), fraction: progress, tab: "data" });
  act(
    coregRunning && {
      id: "coreg",
      label: tx("Koregistrierung"),
      detail: `${regQueue.running ? (byId(regQueue.running) ? entryShort(byId(regQueue.running)!) : "") : ""}${regQueue.waiting.length ? ` · ${regQueue.waiting.length} wartend` : ""}${coregProgress ? ` · ${coregProgress.stage}` : ""}`,
      tab: "registration",
    },
  );
  act(normRunning && !centiloidRunning && { id: "norm", label: tx("Normalisierung"), detail: normProgress?.stage, fraction: normProgress?.fraction ?? null, tab: "normalization" });
  act(transferBusy && { id: "transfer", label: tx("Übertragung"), detail: transferStatus ?? undefined, tab: "normalization" });
  act(centiloidRunning && { id: "centiloid", label: tx("Centiloid"), detail: normProgress ? normProgress.stage : (centiloidStatus ?? undefined), fraction: normProgress?.fraction ?? null, tab: "suvr" });
  act(
    ctSegRunning && {
      id: "ctseg",
      label: tx("CT-Segmentierung"),
      detail: ctSegProgress ? `${ctSegProgress.stage}${ctSegProgress.inference && ctSegProgress.total ? ` · ${tx("Kachel {n}/{total}", { n: Math.min(ctSegProgress.done + 1, ctSegProgress.total), total: ctSegProgress.total })}` : ""}` : tx("Vorbereitung"),
      fraction: ctSegProgress?.total ? ctSegProgress.done / ctSegProgress.total : null,
      tab: "tumor",
    },
  );
  act(tumorBusy && { id: "tumor", label: tx("Segmentierung & MTV"), detail: tx("Segmentierung"), tab: "tumor" });
  act(fusionBusy && { id: "fusion", label: tx("Fusionsexport"), tab: "view" });
  act(editBusy && { id: "edit", label: tx("Bearbeiten"), tab: "edit" });
  act((catalogBusy || atlasBusy) && { id: "bundled", label: catalogBusy ? tx("Vorlage laden") : tx("Atlas laden"), tab: catalogBusy ? "data" : "analysis" });
  act(exportActivity && { id: "export", label: tx("Export"), detail: exportActivity, tab: "export" });
  act(tripleBusy && { id: "triple", label: tx("Triple-Window-CT"), detail: tripleStatus ?? undefined, tab: "edit" });
  act(imcalcBusy && { id: "imcalc", label: "IMCALC", detail: imcalcBusy, tab: "imcalc" });
  act(dosimetryActivity && { id: "dosimetry", label: tx("Dosimetrie"), detail: dosimetryActivity, tab: "dosimetry" });
  act(kineticsActivity && { id: "kinetics", label: tx("Kinetik"), detail: kineticsActivity.label, fraction: kineticsActivity.fraction, tab: "kinetics" });
  act(ctSegError && !ctSegRunning && { id: "ctseg-error", label: tx("CT-Segmentierung"), error: ctSegError, tab: "tumor" });
  act(normError && !normRunning && { id: "norm-error", label: tx("Normalisierung"), error: normError, tab: "normalization" });
  act(coregError && !coregRunning && { id: "coreg-error", label: tx("Koregistrierung"), error: coregError, tab: "registration" });
  act(centiloidError && !centiloidRunning && { id: "centiloid-error", label: tx("Centiloid"), error: centiloidError, tab: "suvr" });
  act(tumorError && !tumorBusy && { id: "tumor-error", label: tx("Segmentierung & MTV"), error: tumorError, tab: "tumor" });
  // MIP of the topmost visible functional image (not of label images or CT/MR).
  // MIP: own dataset (automatic: PET → SPECT → CT, shown datasets first) and own color table.
  const mipCandidates = [
    ...[...overlays].reverse().filter((e) => e.display.visible),
    ...(reference ? [reference] : []),
    ...entries.filter((e) => e.id !== reference?.id && !overlays.some((o) => o.id === e.id && o.display.visible)),
  ];
  const mipAutoId = autoMipId(
    mipCandidates.map((e) => ({ id: e.id, modality: modalityLabel(unitSource(e.dataset)), excluded: !!(e.dataset.atlas || e.dataset.template || e.dataset.kindLabel) })),
    reference?.id,
  );
  const mipEntry = byId(mipChoice.id) ?? byId(mipAutoId ?? null);
  const mipW2v = mipEntry ? w2vById.get(mipEntry.id) : undefined;
  const mipLayer: ViewerLayer | undefined =
    mipEntry && mipW2v
      ? {
          id: mipEntry.id,
          label: entryShort(mipEntry),
          title: entryLabel(mipEntry),
          volume: frameVolume(mipEntry),
          w2v: mipW2v,
          display: { ...mipEntry.display, lut: mipChoice.lut ?? mipEntry.display.lut, window: mipChoice.window ?? mipEntry.display.window, visible: true, opacity: 1 },
          unit: layerUnits.get(mipEntry.id),
        }
      : undefined;
  const mipLayerId = mipLayer?.id;
  const mipRange = useMemo<[number, number]>(() => {
    const d = mipEntry?.dataset.current.data;
    if (!d) return [0, 1];
    let lo = Infinity, hi = -Infinity;
    for (const v of d)
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    return Number.isFinite(lo) && hi > lo ? [lo, hi] : [0, 1];
  }, [mipEntry?.dataset.current]);

  // Landmark mode (registration): the viewer shows only the dataset whose landmarks are being set.
  const landmarkSideEntry = landmarkMode && activeTab === "registration" && alignTab === "landmarks" && moving && reference ? (landmarkView === "base" ? reference : moving) : null;
  const sideLayers = landmarkSideEntry ? layers.filter((l) => l.id === landmarkSideEntry.id).map((l) => ({ ...l, display: { ...l.display, visible: true, opacity: 1 } })) : [];
  const viewerLayers = sideLayers.length ? sideLayers : layers;

  /** Landmark markers (base amber, dataset cyan) on the registration tab; strong when the point lies in the slice. */
  const landmarkMarkers =
    activeTab === "registration" && reference && moving
      ? [
          ...(!landmarkSideEntry || landmarkSideEntry.id === reference.id ? (reference.landmarks ?? []).map((l) => ({ l, e: reference, color: "#ffb000", tag: "B" })) : []),
          ...(!landmarkSideEntry || landmarkSideEntry.id === moving.id ? (moving.landmarks ?? []).map((l) => ({ l, e: moving, color: "#3bc9db", tag: "D" })) : []),
        ].map((m) => ({ w: applyMat4(m.e.matrix, m.l.p), color: m.color, text: `${m.tag}${m.l.name.replace(/\D+/g, "")}` }))
      : [];
  const landmarkOverlay: ViewerProps["planeOverlay"] = landmarkMarkers.length
    ? (_kind, ctx, toScreen, basis) => {
        const nx = basis.U[1] * basis.V[2] - basis.U[2] * basis.V[1];
        const ny = basis.U[2] * basis.V[0] - basis.U[0] * basis.V[2];
        const nz = basis.U[0] * basis.V[1] - basis.U[1] * basis.V[0];
        const nn = Math.hypot(nx, ny, nz) || 1;
        for (const m of landmarkMarkers) {
          const d = Math.abs(((m.w[0] - basis.origin[0]) * nx + (m.w[1] - basis.origin[1]) * ny + (m.w[2] - basis.origin[2]) * nz) / nn);
          if (d > 25) continue;
          const [u, v] = worldToPlane(basis, m.w);
          const [x, y] = toScreen(u, v);
          const inSlice = d < 3;
          ctx.save();
          ctx.globalAlpha = inSlice ? 1 : 0.45;
          ctx.strokeStyle = m.color;
          ctx.fillStyle = m.color;
          ctx.lineWidth = inSlice ? 2 : 1;
          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.moveTo(x - 11, y);
          ctx.lineTo(x - 3, y);
          ctx.moveTo(x + 3, y);
          ctx.lineTo(x + 11, y);
          ctx.moveTo(x, y - 11);
          ctx.lineTo(x, y - 3);
          ctx.moveTo(x, y + 3);
          ctx.lineTo(x, y + 11);
          ctx.stroke();
          ctx.font = "bold 12px system-ui, sans-serif";
          // Base labels above, dataset labels below the marker (they coincide after the alignment).
          ctx.fillText(m.text, x + 10, m.text.startsWith("B") ? y - 9 : y + 20);
          ctx.restore();
        }
      }
    : undefined;

  return (
    <AppShell
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      panelOpen={panelOpen}
      onPanelOpenChange={setPanelOpen}
      headerActions={
        <>
          <button
            className="secondary-btn"
            disabled={!entries.length || !!projectBusy}
            title={entries.length ? tx("Ganzes Projekt als .recon-Datei speichern (Datensätze, Registrierung, Labelbilder, Einstellungen)") : tx("Erst Daten laden")}
            onClick={() => void saveProjectFile()}
          >
            <Save size={14} /> {projectBusy === "save" ? tx("Wird gespeichert …") : tx("Projekt speichern")}
          </button>
          <button className={`icon-btn${manualOpen ? " active" : ""}`} title={tx("Handbuch")} aria-label={tx("Handbuch öffnen")} aria-pressed={manualOpen} onClick={() => setManualOpen((o) => !o)}>
            ?
          </button>
          <LangToggle />
        </>
      }
      headerInfo={
        <ActivityBar
          activities={activities}
          idleText={entries.length ? tx("{length} {v} geladen", { length: entries.length, v: entries.length === 1 ? "Datensatz" : tx("Datensätze") }) : undefined}
          onOpen={(tab) => {
            setActiveTab(tab);
            setPanelOpen(true);
          }}
        />
      }
    >
      {layers.length > 0 ? (
        <Viewer
          layers={viewerLayers}
          planeOverlay={landmarkOverlay}
          activeLayerId={active && displayedIds.includes(active.id) ? active.id : (reference?.id ?? "")}
          mipLayerId={mipLayerId}
          mipLayer={mipLayer}
          onMipWindowChange={(w) => setMipChoice((m) => ({ ...m, window: w }))}
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
          onLutChange={(id, lut) => {
            const e = byId(id);
            if (e) updateEntry(id, { display: { ...e.display, lut } });
          }}
          layout={layout}
          focusView={focusView}
          onLayoutChange={(l, f) => {
            setLayout(l);
            setFocusView(f);
          }}
          layerPanel={
            entries.length > 0 && (
              <LayerToggle
                mip={{
                  options: entries
                    .filter((e) => !e.dataset.atlas)
                    .map((e, i) => ({ e, i, t: entryTimes.get(e.id) }))
                    .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity) || a.i - b.i)
                    .map(({ e }) => ({ id: e.id, label: entryShort(e), title: entryLabel(e) })),
                  value: mipChoice.id && byId(mipChoice.id) ? mipChoice.id : null,
                  autoLabel: (() => {
                    const a = byId(mipAutoId ?? null);
                    return a ? entryShort(a) : "–";
                  })(),
                  lut: mipChoice.lut,
                  onChange: (id) => setMipChoice((m) => ({ ...m, id, window: null })),
                  onLutChange: (lut) => setMipChoice((m) => ({ ...m, lut })),
                  window: mipChoice.window ?? null,
                  effectiveWindow: mipLayer?.display.window ?? [0, 1],
                  range: mipRange,
                  scale: mipEntry ? (layerUnits.get(mipEntry.id)?.scale ?? 1) : 1,
                  unit: mipEntry ? (layerUnits.get(mipEntry.id)?.label ?? "") : "",
                  onWindowChange: (w) => setMipChoice((m) => ({ ...m, window: w })),
                }}
                rows={[
                  ...[...overlays].reverse().map((e) => ({ id: e.id, label: entryShort(e), title: entryLabel(e), lut: e.display.lut, visible: e.display.visible, opacity: e.display.opacity, role: "overlay" as const, timeMs: entryTimes.get(e.id) })),
                  ...(reference ? [{ id: reference.id, label: entryShort(reference), title: entryLabel(reference), lut: reference.display.lut, visible: reference.display.visible, role: "base" as const, locked: overlays.length === 0, timeMs: entryTimes.get(reference.id) }] : []),
                  ...entries
                    .filter((e) => e.id !== reference?.id && !overlays.some((o) => o.id === e.id))
                    .map((e) => ({ id: e.id, label: entryShort(e), title: tx("{v} – anklicken zum Einblenden", { v: entryLabel(e) }), lut: e.display.lut, visible: false, role: "hidden" as const, timeMs: entryTimes.get(e.id) })),
                ]}
                onVisibleChange={(id, visible) => {
                  const e = byId(id);
                  if (!e) return;
                  if (id !== reference?.id && !overlays.some((o) => o.id === id)) {
                    if (visible) makeOverlay(id);
                  } else updateEntry(id, { display: { ...e.display, visible } });
                }}
                onRemove={removeEntry}
                onOpacityChange={(id, opacity) => {
                  const e = byId(id);
                  if (e) updateEntry(id, { display: { ...e.display, opacity } });
                }}
              />
            )
          }
          toolbarRight={
            [...suvById.values()].some((x) => x?.ok) ? (
              <span className="unit-toggle" role="group" aria-label={tx("Werte von PET und SPECT")}>
                <button className={unitMode === "suv" ? "active" : ""} aria-pressed={unitMode === "suv"} title={tx("PET/SPECT mit SUV-Angaben im Header als SUV (Körpergewicht) – für die ganze App")} onClick={() => handleUnitModeChange("suv")}>
                  SUV
                </button>
                <button className={unitMode === "raw" ? "active" : ""} aria-pressed={unitMode === "raw"} title={tx("Originalwerte aus dem Header (Counts, Bq/ml) – für die ganze App")} onClick={() => handleUnitModeChange("raw")}>
                  {tx("Counts/Bq/ml")}
                </button>
              </span>
            ) : undefined
          }
          toolbar={
            entries.length > 1 &&
            active && (
              <span className="toolbar-note">
                {tx("Aktiv:")} <strong title={entryLabel(active)}>{entryShort(active, 26)}</strong>
              </span>
            )
          }
        />
      ) : (
        <div className="welcome">
          <div className="welcome-card">
            <h2>{tx("Willkommen in Recon Studio")}</h2>
            <p>
              {projectionSet
                ? tx("Rohdaten geladen – im Panel „Daten“ die Rekonstruktion starten.")
                : tx("PET-, SPECT-, CT- oder MRT-Daten als DICOM (einzeln oder als Serie) bzw. NIfTI laden, SPECT-Rohdaten rekonstruieren, analysieren, bearbeiten, coregistrieren und exportieren.")}
            </p>
            {!projectionSet && (
              <div className="welcome-actions">
                <button
                  className="primary-btn"
                  onClick={() => {
                    setActiveTab("data");
                    setPanelOpen(true);
                  }}
                >
                  {tx("Daten laden")}
                </button>
                <button className="secondary-btn" disabled={!!projectBusy} onClick={() => projectInput.current?.click()}>
                  {projectBusy === "open" ? tx("Wird geöffnet …") : tx("Projekt öffnen …")}
                </button>
              </div>
            )}
            {projectError && <div className="error-banner">{projectError}</div>}
            <p className="welcome-note">{tx("Alle Daten werden ausschließlich lokal im Browser verarbeitet.")}</p>
          </div>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button className="icon-btn small" aria-label={tx("Hinweis schließen")} onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
      {manualOpen && <ManualOverlay onClose={closeManual} />}
    </AppShell>
  );
}

export default App;
