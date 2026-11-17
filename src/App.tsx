import { useMemo, useRef, useState } from "react";
import { AnalysisPanel } from "./components/AnalysisPanel";
import { EditPanel } from "./components/EditPanel";
import { computeStats } from "./analysis/stats";
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
import { FourPanelViewer } from "./viewer/FourPanelViewer";
import type { SpectProjectionSet } from "./dicom/types";
import "./App.css";

function App() {
  const [projectionSet, setProjectionSet] = useState<SpectProjectionSet | null>(null);
  const [dataset, setDataset] = useState<LoadedDataset | null>(null);
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sino = useMemo(() => (projectionSet ? buildSinogram(projectionSet) : null), [projectionSet]);

  const volume = dataset?.current ?? null;
  const stats = useMemo(() => (volume ? computeStats(volume.data) : null), [volume]);

  function showDataset(next: LoadedDataset) {
    setDataset(next);
    const s = computeStats(next.current.data);
    setThreshold(Number.isFinite(s.max) ? String(s.max) : "0");
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
          {volume ? (
            <FourPanelViewer volume={volume} />
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
            <AnalysisPanel volume={volume} stats={stats} marker={Number(threshold.replace(",", "."))} />
            <EditPanel
              volume={volume}
              stats={stats}
              edits={dataset.edits}
              threshold={threshold}
              onThresholdChange={setThreshold}
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

export default App;
