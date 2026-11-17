import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Download, Eye, FolderOpen, Wand2 } from "lucide-react";
import { AppShell, type ShellTab } from "./ui/AppShell";
import { DatasetInfo } from "./ui/DatasetInfo";
import { LayerSettings, type WindowPreset } from "./ui/ViewSettingsPanel";
import { RegistrationPanel } from "./ui/RegistrationPanel";
import { CT_PRESETS, defaultDisplay, isAnatomical, modalityLabel, rawUnitLabel, suvForSource } from "./dataset/describe";
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
import {
  IDENTITY_RIGID,
  type RigidParams,
  type Vec3,
  registeredWorldToVoxel,
  volumeCenter,
  worldToVoxelTransform,
} from "./core/geometry";
import type { SpectProjectionSet } from "./dicom/types";
import "./App.css";

/** Functional = PET/SPECT (SUV, fusion overlay), anatomical = CT/MR (fusion base). */
type Role = "functional" | "anatomical";

interface Slot {
  dataset: LoadedDataset;
  display: LayerDisplay;
}

const ROLE_LABEL: Record<Role, string> = { functional: "PET/SPECT", anatomical: "CT" };

function App() {
  const [projectionSet, setProjectionSet] = useState<SpectProjectionSet | null>(null);
  const [slots, setSlots] = useState<Partial<Record<Role, Slot>>>({});
  const [activeRole, setActiveRole] = useState<Role>("functional");
  const [registration, setRegistration] = useState<RigidParams>(IDENTITY_RIGID);
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
  const abortRef = useRef<AbortController | null>(null);
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

  const functional = slots.functional;
  const anatomical = slots.anatomical;
  const role: Role = slots[activeRole] ? activeRole : functional ? "functional" : "anatomical";
  const dataset = slots[role]?.dataset ?? null;
  const volume = dataset?.current ?? null;
  const stats = useMemo(() => (volume ? computeStats(volume.data) : null), [volume]);

  // SUV applies to the functional dataset only.
  const functionalSource = functional?.dataset.source;
  const suv = useMemo(() => (functionalSource ? suvForSource(functionalSource) : null), [functionalSource]);
  const suvActive = unitMode === "suv" && !!suv?.ok;
  const functionalScale = suvActive && suv?.ok ? suv.info.factor : 1;
  const functionalUnitLabel = suvActive ? "SUV" : functionalSource ? rawUnitLabel(functionalSource) : "";
  const anatomicalUnitLabel = anatomical ? rawUnitLabel(anatomical.dataset.source) : "";
  const scale = role === "functional" ? functionalScale : 1;
  const unitLabel = role === "functional" ? functionalUnitLabel : anatomicalUnitLabel;

  // ── Viewer layers: CT at the bottom, PET/SPECT on top (moved by the registration). ──
  const functionalVolume = functional?.dataset.current;
  const anatomicalVolume = anatomical?.dataset.current;
  const fused = !!functionalVolume && !!anatomicalVolume;
  const functionalW2v = useMemo(() => {
    if (!functionalVolume) return null;
    const base = worldToVoxelTransform(functionalVolume.geometry);
    if (!fused) return base;
    const center = volumeCenter(functionalVolume.geometry, [functionalVolume.nx, functionalVolume.ny, functionalVolume.nz]);
    return registeredWorldToVoxel(base, registration, center);
  }, [functionalVolume, fused, registration]);
  const anatomicalW2v = useMemo(() => (anatomicalVolume ? worldToVoxelTransform(anatomicalVolume.geometry) : null), [anatomicalVolume]);
  const functionalUnit = useMemo(() => ({ scale: functionalScale, label: functionalUnitLabel }), [functionalScale, functionalUnitLabel]);
  const anatomicalUnit = useMemo(() => ({ scale: 1, label: anatomicalUnitLabel }), [anatomicalUnitLabel]);
  const functionalDisplay = functional?.display;
  const anatomicalDisplay = anatomical?.display;
  const functionalLabel = modalityLabel(functionalSource);
  const anatomicalLabel = modalityLabel(anatomical?.dataset.source);

  const layers = useMemo<ViewerLayer[]>(() => {
    const out: ViewerLayer[] = [];
    if (anatomicalVolume && anatomicalW2v && anatomicalDisplay)
      out.push({ id: "anatomical", label: anatomicalLabel, volume: anatomicalVolume, w2v: anatomicalW2v, display: anatomicalDisplay, unit: anatomicalUnit });
    if (functionalVolume && functionalW2v && functionalDisplay)
      out.push({ id: "functional", label: functionalLabel, volume: functionalVolume, w2v: functionalW2v, display: functionalDisplay, unit: functionalUnit });
    return out;
  }, [anatomicalVolume, anatomicalW2v, anatomicalDisplay, anatomicalLabel, anatomicalUnit, functionalVolume, functionalW2v, functionalDisplay, functionalLabel, functionalUnit]);

  function setDisplay(r: Role, display: LayerDisplay) {
    setSlots((prev) => (prev[r] ? { ...prev, [r]: { ...prev[r]!, display } } : prev));
  }

  function setDataset(r: Role, next: LoadedDataset) {
    setSlots((prev) => (prev[r] ? { ...prev, [r]: { ...prev[r]!, dataset: next } } : prev));
  }

  /** Resets the edit inputs to the maximum of the given dataset (in its display units). */
  function resetEditInputs(next: LoadedDataset, displayScale: number) {
    const s = computeStats(next.current.data);
    setThreshold(Number.isFinite(s.max) ? formatInput(s.max * displayScale) : "0");
    setNewValue("0");
  }

  function placeDataset(next: LoadedDataset, r: Role) {
    setSlots((prev) => {
      const updated: Partial<Record<Role, Slot>> = { ...prev, [r]: { dataset: next, display: defaultDisplay(next.current, next.source) } };
      // Fusion defaults: colored, semi-transparent PET/SPECT over the CT.
      const f = updated.functional;
      if (updated.anatomical && f && f.display.lut === "gray") updated.functional = { ...f, display: { ...f.display, lut: "kidney", opacity: 0.6 } };
      return updated;
    });
    setCursor(null);
    // A CT added for fusion does not take over analysis/editing from an existing PET/SPECT.
    const becomesActive = r === "functional" || !slots.functional;
    if (becomesActive) setActiveRole(r);
    let nextScale = 1;
    if (r === "functional") {
      const nextSuv = suvForSource(next.source);
      nextScale = nextSuv?.ok ? nextSuv.info.factor : 1;
      setUnitMode(nextSuv?.ok ? "suv" : "raw");
      setRegistration(IDENTITY_RIGID);
    }
    if (becomesActive) resetEditInputs(next, nextScale);
  }

  function handleUnitModeChange(mode: UnitMode) {
    if (mode === unitMode || !suv?.ok) return;
    if (role === "functional") {
      const factor = mode === "suv" ? suv.info.factor : 1 / suv.info.factor;
      const convert = (text: string) => {
        const v = parseInput(text);
        return Number.isFinite(v) ? formatInput(v * factor) : text;
      };
      setThreshold(convert(threshold));
      setNewValue(convert(newValue));
    }
    setUnitMode(mode);
  }

  function switchActive(r: Role) {
    const slot = slots[r];
    if (!slot || r === role) return;
    setActiveRole(r);
    resetEditInputs(slot.dataset, r === "functional" ? functionalScale : 1);
  }

  function handleLoaded(set: SpectProjectionSet) {
    setProjectionSet(set);
    setError(null);
  }

  function handleVolumeLoaded(loaded: LoadedVolume, fileName: string, forcedRole?: Role) {
    const r: Role = forcedRole ?? (isAnatomical(loaded.source) ? "anatomical" : "functional");
    if (r === "functional") setProjectionSet(null);
    placeDataset(createDataset(loaded.volume, loaded.source, fileName), r);
    setError(null);
  }

  function handleApplyEdit(op: EditOp) {
    if (!dataset) return;
    const { volume: next } = applyEdit(dataset.current, op);
    setDataset(role, { ...dataset, current: next, history: [...dataset.history, dataset.current], edits: [...dataset.edits, op] });
  }

  function handleUndo() {
    if (!dataset || dataset.history.length === 0) return;
    setDataset(role, {
      ...dataset,
      current: dataset.history[dataset.history.length - 1],
      history: dataset.history.slice(0, -1),
      edits: dataset.edits.slice(0, -1),
    });
  }

  function handleReset() {
    if (!dataset) return;
    setDataset(role, { ...dataset, current: dataset.original, history: [], edits: [] });
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
      placeDataset(createDataset(vol, { kind: "reconstruction", reconParams: params }, projectionSet.meta.sourceFileName), "functional");
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

  function removeSlot(r: Role) {
    setSlots((prev) => {
      const next = { ...prev };
      delete next[r];
      return next;
    });
    if (r === "functional") setRegistration(IDENTITY_RIGID);
    setActiveRole(r === "functional" ? "anatomical" : "functional");
  }

  // ── Panels ──
  const functionalPresets: WindowPreset[] = functionalVolume
    ? [
        { label: "Auto", window: defaultDisplay(functionalVolume, functionalSource).window },
        ...(suv?.ok ? [5, 10, 15].map((m) => ({ label: `SUV 0–${m}`, window: [0, m / suv.info.factor] as [number, number] })) : []),
      ]
    : [];
  const anatomicalPresets: WindowPreset[] = anatomicalVolume
    ? anatomicalLabel === "CT"
      ? CT_PRESETS
      : [{ label: "Auto", window: defaultDisplay(anatomicalVolume, anatomical?.dataset.source).window }]
    : [];

  let frameNote: string | undefined;
  if (functionalVolume && anatomicalVolume) {
    const a = functionalVolume.geometry.frameOfReferenceUid;
    const b = anatomicalVolume.geometry.frameOfReferenceUid;
    if (!functionalVolume.hasPatientGeometry || !anatomicalVolume.hasPatientGeometry)
      frameNote = "Für mindestens einen Datensatz sind keine Patientenkoordinaten bekannt – die Ausrichtung muss manuell erfolgen.";
    else if (a && b && a !== b)
      frameNote = "Unterschiedliche Frame-of-Reference-UIDs: Die Datensätze stammen evtl. aus verschiedenen Untersuchungen – Ausrichtung prüfen.";
  }

  const dataTab = (
    <>
      <VolumeUploadPanel
        onLoaded={(l, n) => handleVolumeLoaded(l, n)}
        description="PET, SPECT oder CT als DICOM (Datei oder ganze Serie) bzw. NIfTI. CT wird automatisch als Fusionsbasis verwendet."
      />
      {functional && <DatasetInfo dataset={functional.dataset} title={`Funktionell · ${functionalLabel}`} onRemove={() => removeSlot("functional")} />}
      {anatomical ? (
        <DatasetInfo dataset={anatomical.dataset} title={`Anatomisch · ${anatomicalLabel}`} onRemove={() => removeSlot("anatomical")} />
      ) : (
        functional && (
          <VolumeUploadPanel
            title="CT für Fusion laden"
            description="CT-Serie derselben Untersuchung; die Ausrichtung erfolgt über die Patientenkoordinaten und kann im Panel „Ansicht“ fein korrigiert werden."
            onLoaded={(l, n) => handleVolumeLoaded(l, n, "anatomical")}
          />
        )
      )}
      <details className="card collapsible" open={!functional || !!projectionSet}>
        <summary>SPECT-Rohdaten rekonstruieren</summary>
        <UploadPanel onLoaded={handleLoaded} />
        {projectionSet && (
          <ReconControls projectionSet={projectionSet} busy={busy} progress={progress} onStart={handleStart} onCancel={handleCancel} />
        )}
      </details>
      {error && <div className="error-banner">{error}</div>}
    </>
  );

  const viewTab = (
    <>
      {functional && (
        <LayerSettings
          title={`${functionalLabel}${fused ? " · Overlay" : ""}`}
          display={functional.display}
          onChange={(d) => setDisplay("functional", d)}
          scale={functionalScale}
          unitLabel={functionalUnitLabel}
          presets={functionalPresets}
          showOpacity={fused}
          showVisibility={fused}
        />
      )}
      {anatomical && (
        <LayerSettings
          title={`${anatomicalLabel}${fused ? " · Basis" : ""}`}
          display={anatomical.display}
          onChange={(d) => setDisplay("anatomical", d)}
          scale={1}
          unitLabel={anatomicalUnitLabel}
          presets={anatomicalPresets}
          showVisibility={fused}
        />
      )}
      {fused && <RegistrationPanel params={registration} onChange={setRegistration} frameNote={frameNote} />}
    </>
  );

  const tabs: ShellTab[] = [
    { id: "data", label: "Daten", icon: FolderOpen, content: dataTab },
    { id: "view", label: "Ansicht", icon: Eye, disabled: layers.length === 0, content: viewTab },
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
          suv={role === "functional" ? suv : null}
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

  const roles = (["functional", "anatomical"] as Role[]).filter((r) => slots[r]);

  return (
    <AppShell
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      panelOpen={panelOpen}
      onPanelOpenChange={setPanelOpen}
      theme={theme}
      onThemeChange={setTheme}
      headerInfo={roles.map((r) => {
        const d = slots[r]!.dataset;
        return (
          <button
            key={r}
            className={`dataset-chip clickable${r === role && roles.length > 1 ? " active" : ""}`}
            title={`${ROLE_LABEL[r]}: ${d.displayName}${roles.length > 1 ? " – klicken, um Analyse, Bearbeitung und Export auf diesen Datensatz anzuwenden" : ""}`}
            onClick={() => switchActive(r)}
          >
            <span className="badge">{modalityLabel(d.source)}</span>
            <span className="chip-name">{d.displayName}</span>
            {d.edits.length > 0 && <span className="chip-edited">bearbeitet</span>}
          </button>
        );
      })}
    >
      {layers.length > 0 ? (
        <Viewer
          layers={layers}
          activeLayerId={role}
          mipLayerId={functional ? "functional" : "anatomical"}
          cursor={cursor}
          onCursorChange={setCursor}
          onWindowChange={(id, window) => {
            const r = id as Role;
            const slot = slots[r];
            if (slot) setDisplay(r, { ...slot.display, window });
          }}
          layout={layout}
          focusView={focusView}
          onLayoutChange={(l, f) => {
            setLayout(l);
            setFocusView(f);
          }}
          toolbar={
            roles.length > 1 && (
              <span className="toolbar-note">
                Aktiv: <strong>{modalityLabel(slots[role]!.dataset.source)}</strong>
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
