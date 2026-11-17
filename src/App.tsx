import { useMemo, useRef, useState } from "react";
import { AnalysisPanel } from "./components/AnalysisPanel";
import { EditPanel } from "./components/EditPanel";
import { computeStats } from "./analysis/stats";
import { type SuvResult, computeSuv } from "./analysis/suv";
import type { VolumeSource } from "./dataset/types";
import { type UnitMode, formatInput, parseInput } from "./components/format";
import { type LoadedDataset, createDataset } from "./dataset/types";
import { type EditOp, applyEdit } from "./edit/operations";
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
import type { ColorLut } from "./viewer/volume";
import { type Vec3, worldToVoxelTransform } from "./core/geometry";
import type { SpectProjectionSet } from "./dicom/types";
import "./App.css";

function App() {
  const [projectionSet, setProjectionSet] = useState<SpectProjectionSet | null>(null);
  const [dataset, setDataset] = useState<LoadedDataset | null>(null);
  const [threshold, setThreshold] = useState("");
  const [newValue, setNewValue] = useState("0");
  const [unitMode, setUnitMode] = useState<UnitMode>("raw");
  const [cursor, setCursor] = useState<Vec3 | null>(null);
  const [layout, setLayout] = useState<LayoutKind>("grid");
  const [focusView, setFocusView] = useState<ViewKind>("axial");
  const [display, setDisplay] = useState<LayerDisplay | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sino = useMemo(() => (projectionSet ? buildSinogram(projectionSet) : null), [projectionSet]);

  const volume = dataset?.current ?? null;
  const stats = useMemo(() => (volume ? computeStats(volume.data) : null), [volume]);

  const source = dataset?.source;
  const suv = useMemo(() => (source ? suvForSource(source) : null), [source]);
  const rawUnit = dataset ? rawUnitLabel(dataset.source) : "";
  const scale = unitMode === "suv" && suv?.ok ? suv.info.factor : 1;
  const unitLabel = unitMode === "suv" && suv?.ok ? "SUV" : rawUnit;

  const unit = useMemo(() => ({ scale, label: unitLabel }), [scale, unitLabel]);
  const w2v = useMemo(() => (volume ? worldToVoxelTransform(volume.geometry) : null), [volume]);
  const layers = useMemo<ViewerLayer[]>(
    () =>
      volume && w2v && display
        ? [{ id: "functional", label: modalityLabel(dataset?.source) ?? "Volumen", volume, w2v, display, unit }]
        : [],
    [volume, w2v, display, unit, dataset?.source],
  );

  function showDataset(next: LoadedDataset) {
    setDataset(next);
    setCursor(null);
    setDisplay(defaultDisplay(next.current));
    const s = computeStats(next.current.data);
    const nextSuv = suvForSource(next.source);
    const nextScale = nextSuv?.ok ? nextSuv.info.factor : 1;
    setUnitMode(nextSuv?.ok ? "suv" : "raw");
    setThreshold(Number.isFinite(s.max) ? formatInput(s.max * nextScale) : "0");
    setNewValue("0");
  }

  function handleUnitModeChange(mode: UnitMode) {
    if (mode === unitMode || !suv?.ok) return;
    const factor = mode === "suv" ? suv.info.factor : 1 / suv.info.factor;
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
    setDataset(null);
    setError(null);
  }

  function handleVolumeLoaded(loaded: LoadedVolume, fileName: string) {
    setProjectionSet(null);
    showDataset(createDataset(loaded.volume, loaded.source, fileName));
    setError(null);
  }

  function handleApplyEdit(op: EditOp) {
    if (!dataset) return;
    const { volume: next } = applyEdit(dataset.current, op);
    setDataset({ ...dataset, current: next, history: [...dataset.history, dataset.current], edits: [...dataset.edits, op] });
  }

  function handleUndo() {
    if (!dataset || dataset.history.length === 0) return;
    setDataset({
      ...dataset,
      current: dataset.history[dataset.history.length - 1],
      history: dataset.history.slice(0, -1),
      edits: dataset.edits.slice(0, -1),
    });
  }

  function handleReset() {
    if (!dataset) return;
    setDataset({ ...dataset, current: dataset.original, history: [], edits: [] });
  }

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
      showDataset(createDataset(vol, { kind: "reconstruction", reconParams: params }, projectionSet.meta.sourceFileName));
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

  return (
    <div className="app-root">
      <header className="app-header">
        <h1>SPECT-Rekonstruktion</h1>
      </header>
      <div className="app-body">
        <aside className="app-sidebar">
          <UploadPanel onLoaded={handleLoaded} />
          <div className="upload-separator"><span>oder</span></div>
          <VolumeUploadPanel onLoaded={handleVolumeLoaded} />
          {projectionSet && (
            <ReconControls
              projectionSet={projectionSet}
              busy={busy}
              progress={progress}
              onStart={handleStart}
              onCancel={handleCancel}
            />
          )}
          {dataset && <ExportPanel dataset={dataset} />}
          {error && <div className="error-banner">{error}</div>}
        </aside>
        <main className="app-main">
          {layers.length > 0 && display ? (
            <Viewer
              layers={layers}
              activeLayerId="functional"
              cursor={cursor}
              onCursorChange={setCursor}
              onWindowChange={(_, window) => setDisplay({ ...display, window })}
              layout={layout}
              focusView={focusView}
              onLayoutChange={(l, f) => {
                setLayout(l);
                setFocusView(f);
              }}
              toolbar={
                <>
                  <select value={display.lut} onChange={(e) => setDisplay({ ...display, lut: e.target.value as ColorLut })} aria-label="Farbtabelle">
                    <option value="gray">Grau</option>
                    <option value="inverted">Invertiert</option>
                    <option value="rainbow">Regenbogen</option>
                    <option value="kidney">Hot</option>
                  </select>
                  <button onClick={() => volume && setDisplay({ ...display, window: defaultDisplay(volume).window })}>Fenster zurücksetzen</button>
                </>
              }
            />
          ) : (
            <div className="empty-state">
              {projectionSet
                ? "Rohdaten geladen. Rekonstruktion starten, um die Ansicht zu sehen."
                : "Bitte SPECT-Rohdaten hochladen, um zu beginnen."}
            </div>
          )}
        </main>
        {dataset && volume && stats && (
          <aside className="app-tools">
            <AnalysisPanel
              volume={volume}
              stats={stats}
              marker={parseInput(threshold) / scale}
              scale={scale}
              unitLabel={unitLabel}
              unitMode={unitMode}
              suv={suv}
              onUnitModeChange={handleUnitModeChange}
            />
            <EditPanel
              volume={volume}
              stats={stats}
              edits={dataset.edits}
              scale={scale}
              unitLabel={unitLabel}
              threshold={threshold}
              onThresholdChange={setThreshold}
              value={newValue}
              onValueChange={setNewValue}
              onApply={handleApplyEdit}
              onUndo={handleUndo}
              onReset={handleReset}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

function modalityLabel(source: VolumeSource | undefined): string | undefined {
  if (!source) return undefined;
  if (source.kind === "reconstruction") return "SPECT";
  if (source.kind === "nifti") return "NIfTI";
  return source.files[0].dataSet.string("x00080060")?.trim() || "DICOM";
}

/** Initial window: from 0 (or the minimum, if negative) to the 99.5th percentile. */
function defaultDisplay(volume: Volume3D): LayerDisplay {
  const hi = volume.percentile(99.5);
  let lo = 0;
  for (let i = 0; i < volume.data.length; i += 97) if (volume.data[i] < lo) lo = volume.data[i];
  return { window: [lo, hi > lo ? hi : lo + 1], lut: "gray", opacity: 1, visible: true };
}

function suvForSource(source: VolumeSource): SuvResult | null {
  return source.kind === "dicom" ? computeSuv(source.files[0].dataSet) : null;
}

function rawUnitLabel(source: VolumeSource): string {
  if (source.kind !== "dicom") return "";
  const units = source.files[0].dataSet.string("x00541001")?.trim();
  return units === "BQML" ? "Bq/ml" : (units ?? "");
}

export default App;
