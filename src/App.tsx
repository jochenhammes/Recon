import { useMemo, useRef, useState } from "react";
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
  const [volume, setVolume] = useState<Volume3D | null>(null);
  const [lastReconParams, setLastReconParams] = useState<ReconParams | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string>("recon");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sino = useMemo(() => (projectionSet ? buildSinogram(projectionSet) : null), [projectionSet]);

  function handleLoaded(set: SpectProjectionSet) {
    setProjectionSet(set);
    setSourceFileName(set.meta.sourceFileName);
    setVolume(null);
    setLastReconParams(null);
    setError(null);
  }

  function handleVolumeLoaded(vol: Volume3D, fileName: string) {
    setProjectionSet(null);
    setLastReconParams(null);
    setSourceFileName(fileName);
    setVolume(vol);
    setError(null);
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
      setVolume(vol);
      setLastReconParams(params);
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
          {volume && (
            <ExportPanel
              volume={volume}
              reconParams={lastReconParams ?? undefined}
              sourceFileName={sourceFileName}
            />
          )}
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
      </div>
    </div>
  );
}

export default App;
