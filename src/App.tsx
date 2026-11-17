import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Download, Eye, FolderOpen, Wand2 } from "lucide-react";
import { AppShell, type ShellTab } from "./ui/AppShell";
import { DatasetInfo } from "./ui/DatasetInfo";
import { LayerSettings, type WindowPreset } from "./ui/ViewSettingsPanel";
import { defaultDisplay, modalityLabel, rawUnitLabel, suvForSource } from "./dataset/describe";
import { AnalysisPanel } from "./components/AnalysisPanel";
import { EditPanel } from "./components/EditPanel";
import { computeStats } from "./analysis/stats";
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
  const [activeTab, setActiveTab] = useState("data");
  const [panelOpen, setPanelOpen] = useState(true);
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
        ? [{ id: "functional", label: modalityLabel(dataset?.source), volume, w2v, display, unit }]
        : [],
    [volume, w2v, display, unit, dataset?.source],
  );

  function showDataset(next: LoadedDataset) {
    setDataset(next);
    setCursor(null);
    setDisplay(defaultDisplay(next.current, next.source));
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

  const presets: WindowPreset[] = volume
    ? [
        { label: "Auto", window: defaultDisplay(volume, dataset?.source).window },
        ...(suv?.ok ? [5, 10, 15].map((m) => ({ label: `SUV 0–${m}`, window: [0, m / suv.info.factor] as [number, number] })) : []),
      ]
    : [];

  const dataTab = (
    <>
      <VolumeUploadPanel onLoaded={handleVolumeLoaded} />
      {dataset && <DatasetInfo dataset={dataset} title="Geladener Datensatz" />}
      <details className="card collapsible" open={!dataset || !!projectionSet}>
        <summary>SPECT-Rohdaten rekonstruieren</summary>
        <UploadPanel onLoaded={handleLoaded} />
        {projectionSet && (
          <ReconControls projectionSet={projectionSet} busy={busy} progress={progress} onStart={handleStart} onCancel={handleCancel} />
        )}
      </details>
      {error && <div className="error-banner">{error}</div>}
    </>
  );

  const tabs: ShellTab[] = [
    { id: "data", label: "Daten", icon: FolderOpen, content: dataTab },
    {
      id: "view",
      label: "Ansicht",
      icon: Eye,
      disabled: !display,
      content: display && (
        <LayerSettings
          title={modalityLabel(dataset?.source)}
          display={display}
          onChange={setDisplay}
          scale={scale}
          unitLabel={unitLabel}
          presets={presets}
        />
      ),
    },
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
          suv={suv}
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
      ),
    },
    { id: "export", label: "Export", icon: Download, disabled: !dataset, content: dataset && <ExportPanel dataset={dataset} /> },
  ];

  return (
    <AppShell
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      panelOpen={panelOpen}
      onPanelOpenChange={setPanelOpen}
      theme={theme}
      onThemeChange={setTheme}
      headerInfo={
        dataset && (
          <span className="dataset-chip" title={dataset.displayName}>
            <span className="badge">{modalityLabel(dataset.source)}</span>
            <span className="chip-name">{dataset.displayName}</span>
            {dataset.edits.length > 0 && <span className="chip-edited">bearbeitet</span>}
          </span>
        )
      }
    >
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
        />
      ) : (
        <div className="welcome">
          <div className="welcome-card">
            <h2>Willkommen in Recon Studio</h2>
            <p>
              {projectionSet
                ? "Rohdaten geladen – im Panel „Daten“ die Rekonstruktion starten."
                : "PET-, SPECT- oder CT-Daten als DICOM (einzeln oder als Serie) bzw. NIfTI laden, SPECT-Rohdaten rekonstruieren, analysieren, bearbeiten, mit CT fusionieren und exportieren."}
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
