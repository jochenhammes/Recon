import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Crosshair, Download, Eye, FileCode2, FolderOpen, Wand2 } from "lucide-react";
import { CoregPanel, type CoregSettings } from "./ui/CoregPanel";
import { type RegistrationRun, runCoregistration } from "./registration/runner";
import type { CoregProgress, CoregResult } from "./registration/coregister";
import { HeaderPanel } from "./ui/HeaderPanel";
import { AppShell, type ShellTab } from "./ui/AppShell";
import { DatasetInfo } from "./ui/DatasetInfo";
import { LayerSettings, type WindowPreset } from "./ui/ViewSettingsPanel";
import { RegistrationPanel } from "./ui/RegistrationPanel";
import { CT_PRESETS, defaultDisplay, isAnatomical, modalityLabel, rawUnitLabel, suvForSource } from "./dataset/describe";
import { AnalysisPanel } from "./components/AnalysisPanel";
import { type BrushState, FilterSection, GeometrySection, HistorySection, ValueSection, VoiSection, type VoiTool } from "./components/EditTools";
import { runEdits } from "./edit/runner";
import { type VoiShape, maskBounds, paintDisc, voiMask, voiStats } from "./edit/voi";
import { computeStats } from "./analysis/stats";
import type { SuvResult } from "./analysis/suv";
import { type UnitMode, formatInput, parseInput } from "./components/format";
import { type LoadedDataset, createDataset } from "./dataset/types";
import { type EditOp, type VoiAction, changesGrid, countAffected } from "./edit/operations";
import type { LoadedVolume } from "./viewer/volumeLoader";
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
    for (const e of entries) m.set(e.id, suvForSource(e.dataset.source));
    return m;
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const unitFor = (e: Entry | undefined) => {
    if (!e) return { scale: 1, label: "" };
    const suv = suvById.get(e.id);
    if (unitMode === "suv" && suv?.ok) return { scale: suv.info.factor, label: "SUV" };
    return { scale: 1, label: rawUnitLabel(e.dataset.source) };
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
      out.push({ id: e.id, label: modalityLabel(e.dataset.source), volume: e.dataset.current, w2v, display: display ?? e.display, unit: layerUnits.get(e.id) });
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

  function addDataset(next: LoadedDataset) {
    const entry: Entry = { id: `ds${nextEntryId++}`, dataset: next, display: defaultDisplay(next.current, next.source), matrix: IDENTITY_MAT4 };
    const anatomical = isAnatomical(next.source);
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
  const autoCost = moving && reference && modalityLabel(moving.dataset.source) === modalityLabel(reference.dataset.source) ? "ncc" : "nmi";

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

  // ── Panels ──
  const presetsFor = (e: Entry): WindowPreset[] => {
    const v = e.dataset.current;
    if (modalityLabel(e.dataset.source) === "CT") return CT_PRESETS;
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
              {modalityLabel(e.dataset.source)}
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
        title={`${modalityLabel(e.dataset.source)}${overlay ? (isOverlay ? " · Overlay" : " · Basis") : ""}`}
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

  const fusionExport =
    overlay && reference && w2vById.get(overlay.id)
      ? { functional: overlay.dataset, anatomical: reference.dataset, functionalW2v: w2vById.get(overlay.id)! }
      : undefined;

  const registrationTab = reference && moving && movingCenter && (
    <>
      <CoregPanel
        movingOptions={movingCandidates.map((e) => ({ id: e.id, label: `${modalityLabel(e.dataset.source)} · ${e.dataset.displayName}` }))}
        movingId={moving.id}
        onMovingChange={selectMoving}
        referenceLabel={`${modalityLabel(reference.dataset.source)} · ${reference.dataset.displayName}`}
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
        title={`Manuelle Korrektur ${modalityLabel(moving.dataset.source)} → ${modalityLabel(reference.dataset.source)}`}
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

  const tabs: ShellTab[] = [
    { id: "data", label: "Daten", icon: FolderOpen, content: dataTab, badge: entries.length > 1 ? entries.length : undefined },
    { id: "view", label: "Ansicht", icon: Eye, disabled: layers.length === 0, content: viewTab },
    { id: "registration", label: "Registrierung", shortLabel: "Registr.", icon: Crosshair, disabled: entries.length < 2, content: registrationTab },
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
      content: dataset && <ExportPanel dataset={dataset} fusion={fusionExport} />,
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
          <span className="badge">{modalityLabel(e.dataset.source)}</span>
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
                Aktiv: <strong>{modalityLabel(active.dataset.source)}</strong>
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
