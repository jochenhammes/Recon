import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Brain, Crosshair, Download, Eye, FileCode2, FolderOpen, Wand2 } from "lucide-react";
import { NormalizationPanel, type NormMethod, type Regularization } from "./ui/NormalizationPanel";
import { type Normalization, REGULARIZATION_WEIGHT, sameGrid, describeCoregProgress, describeWarpProgress, fieldFromAffine, pullbackPositions } from "./normalization/model";
import { DEFAULT_WARP } from "./normalization/warp";
import { buildDeformationField, fieldCoverage, parseDeformationField } from "./normalization/yfield";
import { DeformationFieldCard } from "./ui/DeformationFieldCard";
import { CentiloidPanel, type CentiloidOutcome } from "./ui/CentiloidPanel";
import { type CentiloidCalibration, acquisitionWindow, centiloidFromMeans, guessTracer, windowWarning } from "./centiloid/centiloid";
import { type CentiloidVois, VOI_LABELS, type VoiName, loadVois, voiMeans, voiVolumeMl } from "./centiloid/vois";
import { AtlasPanel, type RegionResult } from "./ui/AtlasPanel";
import { atlasFromLabels, loadBundledAtlas, parseLabelTable, regionStats } from "./atlas/atlas";
import { runWarp } from "./normalization/warpRunner";
import { runResample } from "./resample/runner";
import { type Interpolation, resampleAtPoints } from "./resample/resample";
import { CoregPanel, type CoregSettings } from "./ui/CoregPanel";
import { type RegistrationRun, runCoregistration } from "./registration/runner";
import type { CoregProgress, CoregResult } from "./registration/coregister";
import { HeaderPanel } from "./ui/HeaderPanel";
import { AppShell, type ShellTab } from "./ui/AppShell";
import { DatasetInfo } from "./ui/DatasetInfo";
import { LayerSettings, type WindowPreset } from "./ui/ViewSettingsPanel";
import { RegistrationPanel } from "./ui/RegistrationPanel";
import { CT_PRESETS, datasetModality, defaultDisplay, isAnatomical, modalityLabel, rawUnitLabel, suvForSource, unitSource } from "./dataset/describe";
import { BUNDLED_MNI, loadBundledMni } from "./normalization/templates";
import { AnalysisPanel } from "./components/AnalysisPanel";
import { type BrushState, FilterSection, GeometrySection, HistorySection, ValueSection, VoiSection, type VoiTool } from "./components/EditTools";
import { runEdits } from "./edit/runner";
import { type VoiShape, maskBounds, paintDisc, voiMask, voiStats } from "./edit/voi";
import { computeStats } from "./analysis/stats";
import type { SuvResult } from "./analysis/suv";
import { type UnitMode, formatInput, parseInput } from "./components/format";
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
  const [overlayId, setOverlayId] = useState<string | null>(null);
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
  const [coregPending, setCoregPending] = useState<{ entryId: string; previous: Mat4; result: CoregResult } | null>(null);
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
  const overlay = overlayId && overlayId !== reference?.id ? byId(overlayId) : undefined;
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

  // ── Viewer layers: reference at the bottom, overlay on top, VOI above. ──
  const layerUnits = new Map(entries.map((e) => [e.id, unitFor(e)]));
  const unitsKey = [...layerUnits.values()].map((u) => `${u.scale}:${u.label}`).join("|");
  const layers = useMemo<ViewerLayer[]>(() => {
    const out: ViewerLayer[] = [];
    const add = (e: Entry | undefined, display?: LayerDisplay) => {
      const w2v = e && w2vById.get(e.id);
      if (!e || !w2v) return;
      out.push({ id: e.id, label: datasetModality(e.dataset), volume: e.dataset.current, w2v, display: display ?? e.display, unit: layerUnits.get(e.id) });
    };
    add(reference, reference ? { ...reference.display, opacity: 1 } : undefined);
    add(overlay);
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
  }, [reference, overlay, w2vById, unitsKey, voiMaskData, volume, activeW2v, voi]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateEntry(id: string, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
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

  function addDataset(next: LoadedDataset): Entry {
    const entry: Entry = { id: `ds${nextEntryId++}`, dataset: next, display: defaultDisplay(next.current, next.source), matrix: IDENTITY_MAT4 };
    if (next.atlas) entry.display = { window: [0, 255], lut: "labels", opacity: 0.45, visible: true };
    if ((next.template || next.atlas) && reference) {
      // Templates and atlases are added without changing reference, overlay or active dataset.
      setEntries((prev) => [...prev, entry]);
      return entry;
    }
    const anatomical = isAnatomical(next.source) || next.template?.kind === "T1";
    const ref = reference;
    let list = [...entries, entry];
    if (!ref) {
      setReferenceId(entry.id);
      setOverlayId(null);
    } else if (anatomical && !isAnatomical(ref.dataset.source)) {
      // CT/MR becomes the display base; the previous reference is shown on top.
      list = list.map((e) => (e.id === ref.id ? { ...e, display: overlayDisplay(e) } : e));
      setReferenceId(entry.id);
      setOverlayId(ref.id);
    } else {
      list = list.map((e) => (e.id === entry.id ? { ...e, display: overlayDisplay(e) } : e));
      setOverlayId(entry.id);
    }
    setEntries(list);
    setCursor(null);
    // A CT/MR added for fusion does not take over analysis/editing from an existing PET/SPECT.
    const becomesActive = !active || !anatomical || isAnatomical(active.dataset.source);
    if (becomesActive) {
      setActiveId(entry.id);
      setVoi(null);
      const suv = suvForSource(next.source);
      if (!anatomical) setUnitMode(suv?.ok ? "suv" : "raw");
      resetEditInputs(next, !anatomical && suv?.ok ? suv.info.factor : 1);
    }
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
    setOverlayId(oldRefId);
  }

  function makeOverlay(id: string | null) {
    if (id && id === reference?.id) return;
    if (id) {
      const e = byId(id);
      if (e) updateEntry(id, { display: overlayDisplay(e) });
    }
    setOverlayId(id);
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
      setOverlayId(rest[1]?.id ?? null);
    } else {
      setEntries(rest);
      if (id === overlay?.id) setOverlayId(rest.find((e) => e.id !== reference?.id)?.id ?? null);
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
    addDataset(createDataset(loaded.volume, loaded.source, fileName));
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

  // ── Coregistration: moving dataset → reference ──
  const movingCandidates = entries.filter((e) => e.id !== reference?.id);
  const moving = byId(movingId) && movingId !== reference?.id ? byId(movingId) : (overlay ?? movingCandidates[0]);
  const autoCost = moving && reference && datasetModality(moving.dataset) === datasetModality(reference.dataset) ? "ncc" : "nmi";

  function selectMoving(id: string) {
    setMovingId(id);
    makeOverlay(id);
  }

  function startCoregistration() {
    if (!moving || !reference || coregRunning) return;
    setCoregError(null);
    setCoregProgress(null);
    setCoregRunning(true);
    makeOverlay(moving.id);
    const previous = moving.matrix;
    const run = runCoregistration(
      reference.dataset.current,
      moving.dataset.current,
      { ...coregSettings, cost: coregSettings.cost === "auto" ? autoCost : coregSettings.cost, initial: previous },
      setCoregProgress,
    );
    coregRun.current = run;
    run.promise
      .then((result) => {
        updateEntry(moving.id, { matrix: result.matrix });
        setCoregPending({ entryId: moving.id, previous, result });
      })
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setCoregError(`Coregistrierung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        setCoregRunning(false);
        coregRun.current = null;
      });
  }

  function discardCoregistration() {
    if (coregPending) updateEntry(coregPending.entryId, { matrix: coregPending.previous });
    setCoregPending(null);
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
      method: coregPending?.entryId === moving.id ? `${coregSettings.dof === 6 ? "rigide" : "affin"}, ${coregPending.result.cost}` : undefined,
      cost: coregPending?.entryId === moving.id ? { name: coregPending.result.cost, before: coregPending.result.before, after: coregPending.result.after } : undefined,
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
      setCoregPending(null);
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
      setCentiloidOutcome(evaluateCentiloid(e, calibration, "vorhandener Datensatz im MNI-Raum"));
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
        const differentStudy = !!pet.dataset.current.geometry.frameOfReferenceUid && pet.dataset.current.geometry.frameOfReferenceUid !== t1.dataset.current.geometry.frameOfReferenceUid;
        const run = runCoregistration(t1.dataset.current, pet.dataset.current, {
          dof: 6,
          cost: "nmi",
          levels: [8, 4, 2],
          coarseSearch: differentStudy,
          initial: multiply4(invert4(t1.matrix), pet.matrix),
        });
        normRun.current = run;
        const reg = await run.promise;
        const petMatrix = multiply4(t1.matrix, reg.matrix);
        updateEntry(pet.id, { matrix: petMatrix });
        overrides.set(pet.id, petMatrix);
        setCentiloidStatus("2/4 T1 → MNI (affin + nichtlinear) …");
        n = await estimateNormalization(template, t1, { nonlinear: true, cost: "ncc", mask: template.dataset.template?.mask ?? undefined, regularization: normRegularization });
        pipeline = `MRT-Pipeline (${n.kind === "nonlinear" ? "nichtlinear" : "affin"})`;
      } else {
        const tpl = templateEntries.find((e) => e.dataset.template?.kind === "PET");
        if (!tpl) throw new Error("Für PET-only wird eine PET-Vorlage benötigt.");
        template = tpl;
        setCentiloidStatus("1/3 PET → PET-Vorlage (affin + nichtlinear) …");
        n = await estimateNormalization(template, pet, { nonlinear: true, cost: "ncc", mask: template.dataset.template?.mask ?? undefined, regularization: normRegularization });
        pipeline = "PET-only";
        warnings.push("PET-only: bei ausgeprägter Atrophie oder vaskulären Läsionen Normalisierung besonders prüfen.");
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

  async function addOwnAtlas(files: File[]) {
    setAtlasError(null);
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
      addDataset({ ...d, atlas: atlasFromLabels(loaded.volume.data, image.name.replace(/\.nii(\.gz)?$/i, ""), labels) });
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
    setOverlayId(id);
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
        setOverlayId(overlayEntry.id);
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
              {datasetModality(e.dataset)}
              {roleBadges(e)}
            </>
          }
          onRemove={() => removeEntry(e.id)}
        >
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
        <VolumeUploadPanel title="Eigene T1-Vorlage (NIfTI)" description="z. B. aus SPM oder CAT12." onLoaded={(l, n) => addOwnTemplate(l, n, "T1")} />
        <VolumeUploadPanel title="Eigene PET-Vorlage (NIfTI)" description="Tracer-spezifische Vorlage (z. B. FDG, Amyloid) für die Normalisierung ohne MRT." onLoaded={(l, n) => addOwnTemplate(l, n, "PET")} />
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

  const layerSettings = (e: Entry, isOverlay: boolean) => {
    const u = unitFor(e);
    return (
      <LayerSettings
        key={e.id}
        title={`${datasetModality(e.dataset)}${overlay ? (isOverlay ? " · Overlay" : " · Basis") : ""}`}
        display={isOverlay ? e.display : { ...e.display, opacity: 1 }}
        onChange={(d) => updateEntry(e.id, { display: d })}
        scale={u.scale}
        unitLabel={u.label}
        presets={presetsFor(e)}
        showOpacity={isOverlay}
        showVisibility={!!overlay}
      />
    );
  };

  const viewTab = (
    <>
      {overlay && layerSettings(overlay, true)}
      {reference && layerSettings(reference, false)}
    </>
  );

  const spaces = entries.flatMap((e) => {
    const w2v = w2vById.get(e.id);
    return w2v ? [{ id: e.id, label: `${datasetModality(e.dataset)} · ${e.dataset.displayName}`, dataset: e.dataset, matrix: e.matrix, w2v }] : [];
  });

  const registrationTab = reference && moving && movingCenter && (
    <>
      <CoregPanel
        movingOptions={movingCandidates.map((e) => ({ id: e.id, label: `${datasetModality(e.dataset)} · ${e.dataset.displayName}` }))}
        movingId={moving.id}
        onMovingChange={selectMoving}
        referenceLabel={`${datasetModality(reference.dataset)} · ${reference.dataset.displayName}`}
        autoCost={autoCost}
        settings={coregSettings}
        onSettingsChange={setCoregSettings}
        running={coregRunning}
        progress={coregProgress}
        onStart={startCoregistration}
        onCancel={() => coregRun.current?.cancel()}
        pending={coregPending?.entryId === moving.id ? coregPending.result : null}
        onAccept={() => setCoregPending(null)}
        onDiscard={discardCoregistration}
        onResetToScanner={() => {
          updateEntry(moving.id, { matrix: IDENTITY_MAT4 });
          setCoregPending(null);
        }}
        onSaveMatrix={saveMatrix}
        onLoadMatrix={(f) => void loadMatrix(f)}
        frameNote={frameNote}
        error={coregError}
      />
      <RegistrationPanel
        title={`Manuelle Korrektur ${datasetModality(moving.dataset)} → ${datasetModality(reference.dataset)}`}
        params={movingParams}
        onChange={(p) => {
          updateEntry(moving.id, { matrix: matrixFromParams(p, movingCenter) });
          setCoregPending(null);
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
  );

  const normalizationTab = (
    <NormalizationPanel
      templates={templateEntries.map((e) => ({ id: e.id, label: e.dataset.template!.name }))}
      templateId={normTemplate?.id ?? null}
      onTemplateChange={setNormTemplateId}
      onLoadMni={() => void addBundledTemplate()}
      mniLoading={templateBusy}
      subjects={subjectCandidates.map((e) => ({ id: e.id, label: `${datasetModality(e.dataset)} · ${e.dataset.displayName}` }))}
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
      transferCandidates={subjectCandidates.map((e) => ({ id: e.id, label: `${datasetModality(e.dataset)} · ${e.dataset.displayName}` }))}
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
        pets={subjectCandidates.filter((e) => !isAnatomical(unitSource(e.dataset))).map((e) => ({ id: e.id, label: `${datasetModality(e.dataset)} · ${e.dataset.displayName}` }))}
        defaultPetId={subjectCandidates.find((e) => datasetModality(e.dataset) === "PT")?.id ?? null}
        t1s={subjectCandidates.map((e) => ({ id: e.id, label: `${datasetModality(e.dataset)} · ${e.dataset.displayName}` }))}
        defaultT1Id={subjectCandidates.find((e) => datasetModality(e.dataset) === "MR")?.id ?? null}
        petTemplateLabel={templateEntries.find((e) => e.dataset.template?.kind === "PET")?.dataset.template?.name ?? null}
        standardTargets={entries
          .filter((e) => e.dataset.derivedFrom && !e.dataset.derivedFrom.label && !isAnatomical(unitSource(e.dataset)))
          .map((e) => ({ id: e.id, label: `${datasetModality(e.dataset)} · ${e.dataset.displayName}` }))}
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
        atlases={entries.filter((e) => e.dataset.atlas).map((e) => ({ id: e.id, label: e.dataset.atlas!.name, atlas: e.dataset.atlas! }))}
        onLoadBundled={() => void addBundledAtlas()}
        bundledLoading={atlasBusy}
        onLoadOwn={(f) => void addOwnAtlas(f)}
        targets={entries.filter((e) => !e.dataset.template && !e.dataset.atlas).map((e) => ({ id: e.id, label: `${datasetModality(e.dataset)} · ${e.dataset.displayName}` }))}
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
      id: "analysis",
      label: "Analyse",
      icon: BarChart3,
      disabled: !stats,
      content: volume && stats && (
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
          paintMode={brush.active && voiTool === "brush" && activeTab === "edit" && panelOpen}
          onPaint={paint}
          cursor={cursor}
          onCursorChange={setCursor}
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
