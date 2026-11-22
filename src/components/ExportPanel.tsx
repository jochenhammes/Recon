import { useMemo, useState } from "react";
import type { Vec3 } from "../core/geometry";
import { isIdentityMat4 } from "../core/transform";
import type { AnonymizeOptions } from "../export/anonymize";
import { type ExportItem, type ExportSettings, type OutFile, exportDatasetFiles, packageFiles, suvApplies } from "../export/exportJob";
import { INTERPOLATION_LABELS, type Interpolation, type TargetGrid, customGrid } from "../resample/resample";
import { Card } from "../ui/Card";
import { InfoText } from "../ui/Info";
import { formatInput, formatValue, parseInput } from "./format";

import { t, tn } from "../i18n";
export interface ExportPanelProps {
  /** All datasets that can be exported (with placement and SUV factor). */
  items: ExportItem[];
  /** Preselected dataset. */
  activeId: string;
  /** Reports the running export (activity indicator); null when done. */
  onActivity?: (text: string | null) => void;
}

type SpaceMode = "native" | "resampled";
type GridMode = "target" | "matrix" | "voxel";

function download(file: { name: string; bytes: Uint8Array<ArrayBuffer>; type: string }) {
  const url = URL.createObjectURL(new Blob([file.bytes], { type: file.type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Export: choose datasets, format (DICOM/NIfTI) and space (own grid without resampling, or resampled into the grid
 * of another dataset); several files are downloaded as one ZIP. NIfTI from PET optionally in SUV.
 */
export function ExportPanel({ items, activeId, onActivity }: ExportPanelProps) {
  const [selected, setSelected] = useState<string[]>([activeId]);
  const [format, setFormat] = useState<"dicom" | "nifti">("nifti");
  const [spaceMode, setSpaceMode] = useState<SpaceMode>("native");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [gridMode, setGridMode] = useState<GridMode>("target");
  const [matrixText, setMatrixText] = useState<string[]>([]);
  const [voxelText, setVoxelText] = useState<string[]>([]);
  const [method, setMethod] = useState<Interpolation>("linear");
  const [suv, setSuv] = useState(true);
  const [markSeries, setMarkSeries] = useState(true);
  const [adjustWindow, setAdjustWindow] = useState(true);
  const [anonymize, setAnonymize] = useState(false);
  const [pseudonym, setPseudonym] = useState("ANONYM");
  const [retainPatientChars, setRetainPatientChars] = useState(true);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const chosen = items.filter((i) => selected.includes(i.id));
  const target = items.find((i) => i.id === targetId) ?? items.find((i) => isIdentityMat4(i.matrix)) ?? items[0];
  const tv = target?.dataset.current;
  const baseGrid: TargetGrid | null = useMemo(() => (tv ? { nx: tv.nx, ny: tv.ny, nz: tv.nz, geometry: tv.geometry } : null), [tv]);
  const matrixValues = (matrixText.length ? matrixText : tv ? [tv.nx, tv.ny, tv.nz].map(String) : []).map(parseInput) as Vec3;
  const voxelValues = (voxelText.length ? voxelText : tv ? tv.geometry.spacing.map((s) => formatInput(s)) : []).map(parseInput) as Vec3;
  const grid: TargetGrid | null = !baseGrid
    ? null
    : gridMode === "target"
      ? baseGrid
      : gridMode === "matrix"
        ? matrixValues.every((v) => v >= 1)
          ? customGrid(baseGrid, { matrix: matrixValues })
          : null
        : voxelValues.every((v) => v > 0)
          ? customGrid(baseGrid, { voxelMm: voxelValues })
          : null;

  const anonOptions: AnonymizeOptions | undefined = anonymize ? { pseudonym, retainPatientCharacteristics: retainPatientChars } : undefined;
  const settings: ExportSettings | null =
    spaceMode === "resampled" && (!grid || !target)
      ? null
      : {
          format,
          space: spaceMode === "native" ? { kind: "native" } : { kind: "resampled", target: target!, grid: grid!, method },
          suv,
          anonymize: anonOptions,
          markSeries,
          adjustWindow,
        };
  const suvCandidates = chosen.filter((i) => i.suvFactor && !i.dataset.atlas);
  const anyDicomSource = chosen.some((i) => i.dataset.source.kind === "dicom");
  const anyEditedDicom = chosen.some((i) => i.dataset.source.kind === "dicom" && i.dataset.edits.length > 0);
  const anyRegistered = chosen.some((i) => !isIdentityMat4(i.matrix));

  async function run() {
    if (!settings || chosen.length === 0) return;
    setWorking(true);
    setError(null);
    setMessages([]);
    const all: OutFile[] = [];
    const warnings: string[] = [];
    try {
      for (const [i, item] of chosen.entries()) {
        const text = `${i + 1}/${chosen.length}: ${item.label}`;
        setStatus(`${text} …`);
        onActivity?.(text);
        await new Promise((r) => setTimeout(r, 20)); // let the status render
        const r = await exportDatasetFiles(item, settings, i, (f) => setStatus(`${text} ${Math.round(f * 100)} %`));
        all.push(...r.files);
        warnings.push(...r.warnings);
        if (format === "nifti" && suv && item.suvFactor && !suvApplies(item, settings)) warnings.push(t("{label}: Labelbild – ohne SUV.", { label: item.label }));
      }
      if (format === "nifti" && suv) {
        const noSuv = chosen.filter((i) => !i.suvFactor && !i.dataset.atlas && /PT|PET/.test(i.label));
        if (noSuv.length) warnings.push(t("Ohne SUV-Angaben (Originalwerte): {v}.", { v: noSuv.map((i) => i.label).join(", ") }));
      }
      setStatus(t("Datei wird erstellt …"));
      const pkg = packageFiles(all, t("Export_{length}_Datensaetze.zip", { length: chosen.length }));
      download(pkg);
      setStatus(`${pkg.name}: ${tn(chosen.length, "{n} Datensatz", "{n} Datensätze")}, ${tn(all.length, "{n} Datei", "{n} Dateien")}.`);
      setMessages(warnings.length > 6 ? [...warnings.slice(0, 5), t("… und {v} weitere Hinweise", { v: warnings.length - 5 })] : warnings);
    } catch (e) {
      setStatus(null);
      setError(t("Export fehlgeschlagen: {v}", { v: e instanceof Error ? e.message : String(e) }));
    } finally {
      setWorking(false);
      onActivity?.(null);
    }
  }

  const gridOf = (i: ExportItem) => {
    const v = i.dataset.current;
    return `${v.nx}×${v.ny}×${v.nz} · ${v.geometry.spacing.map((s) => formatValue(s)).join("×")} mm`;
  };

  return (
    <div className="export-panel">
      <Card
        title={<>{t("Dateien exportieren")}</>}
        info={
          <>
            <p>
              Datensätze anhaken, Format und Raum wählen. Eine Datei wird direkt gespeichert, mehrere als ein ZIP (DICOM-Serien je in einem Ordner).
              Ist im Bereich „Daten“ eine Patient-ID eingetragen, beginnen NIfTI-Dateien (und das ZIP) damit.
            </p>
            <p>
              <strong>{t("Eigenes Raster")}</strong>
              {t(": kein Resampling, jeder Datensatz behält Matrix und Voxelgröße (das PET bleibt in seiner Auflösung). Bei NIfTI steht die Koregistrierung im Header (sform/qform) – in SPM, FSL oder 3D Slicer liegen die Dateien deckungsgleich. DICOM-Serien behalten die Original-Lage.")}
            </p>
            <p>
              <strong>{t("Raster von …")}</strong>: alle Datensätze werden über ihre Registrierung in das Raster eines Datensatzes resampelt (wahlweise mit
              eigener Matrix oder Voxelgröße); Labelbilder immer mit nächstem Nachbarn.
            </p>
            <p>{t("DICOM aus DICOM-Quellen: alle Header-Daten des Originals bleiben erhalten, neue UIDs, ImageType DERIVED. Andere Quellen: Secondary Capture.")}</p>
          </>
        }
      >
        <div className="export-list-head">
          <span>{t("Datensätze")}</span>
          <span>
            <button className="link-btn" disabled={working} onClick={() => setSelected(items.map((i) => i.id))}>
              {t("alle")}
            </button>{" "}
            ·{" "}
            <button className="link-btn" disabled={working} onClick={() => setSelected([])}>
              {t("keine")}
            </button>
          </span>
        </div>
        <div className="imcalc-list export-list">
          {items.map((i) => (
            <label key={i.id} className="checkbox-field" title={gridOf(i)}>
              <input type="checkbox" checked={selected.includes(i.id)} disabled={working} onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, i.id] : prev.filter((x) => x !== i.id)))} />
              <span className="export-item-name">{i.label}</span>
              <em className="export-item-grid">{gridOf(i)}</em>
            </label>
          ))}
        </div>

        <div className="field">
          {t("Format")}
          <div className="segmented-control" role="group" aria-label={t("Format")}>
            {(
              [
                ["nifti", "NIfTI"],
                ["dicom", "DICOM"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={format === k ? "active" : ""} disabled={working} onClick={() => setFormat(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          {t("Raum")}
          <div className="segmented-control" role="group" aria-label={t("Raum")}>
            <button className={spaceMode === "native" ? "active" : ""} disabled={working} onClick={() => setSpaceMode("native")}>
              {t("Eigenes Raster")}
            </button>
            <button className={spaceMode === "resampled" ? "active" : ""} disabled={working} onClick={() => setSpaceMode("resampled")}>
              Raster von … (Resampling)
            </button>
          </div>
        </div>
        {spaceMode === "native" && (
          <p className="tool-hint">
            Kein Resampling.{" "}
            {format === "nifti"
              ? anyRegistered
                ? t("Registrierungen werden in den NIfTI-Header geschrieben.")
                : ""
              : anyRegistered
                ? t("DICOM behält die Original-Lage – für deckungsgleiche DICOM-Dateien „Raster von …“ wählen.")
                : ""}
          </p>
        )}
        {spaceMode === "resampled" && target && tv && (
          <>
            <label className="field">
              {t("Zielraster")}
              <select
                value={target.id}
                disabled={working}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  setMatrixText([]);
                  setVoxelText([]);
                }}
              >
                {items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} – {s.dataset.current.nx}×{s.dataset.current.ny}×{s.dataset.current.nz}
                  </option>
                ))}
              </select>
            </label>
            <div className="segmented-control" role="group" aria-label={t("Raster")}>
              {(
                [
                  ["target", t("wie Ziel")],
                  ["matrix", t("Matrix")],
                  ["voxel", t("Voxelgröße")],
                ] as [GridMode, string][]
              ).map(([m, l]) => (
                <button key={m} className={gridMode === m ? "active" : ""} disabled={working} onClick={() => setGridMode(m)}>
                  {l}
                </button>
              ))}
            </div>
            {gridMode !== "target" && (
              <div className="field-row three">
                {["x", "y", "z"].map((a, i) => (
                  <label key={a} className="field">
                    {a} ({gridMode === "matrix" ? "Voxel" : "mm"})
                    <input
                      type="text"
                      inputMode={gridMode === "matrix" ? "numeric" : "decimal"}
                      value={
                        gridMode === "matrix" ? (matrixText[i] ?? String([tv.nx, tv.ny, tv.nz][i])) : (voxelText[i] ?? formatInput(tv.geometry.spacing[i]))
                      }
                      onChange={(e) => {
                        if (gridMode === "matrix") {
                          const next = matrixText.length ? [...matrixText] : [tv.nx, tv.ny, tv.nz].map(String);
                          next[i] = e.target.value;
                          setMatrixText(next);
                        } else {
                          const next = voxelText.length ? [...voxelText] : tv.geometry.spacing.map((s) => formatInput(s));
                          next[i] = e.target.value;
                          setVoxelText(next);
                        }
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
            {grid && (
              <p className="tool-hint">
                Ergebnis: {grid.nx} × {grid.ny} × {grid.nz} Voxel à {grid.geometry.spacing.map((s) => s.toFixed(2)).join(" × ")} mm.
              </p>
            )}
            <label className="field">
              Interpolation (Labelbilder: nächster Nachbar)
              <select value={method} disabled={working} onChange={(e) => setMethod(e.target.value as Interpolation)}>
                {(Object.keys(INTERPOLATION_LABELS) as Interpolation[]).map((m) => (
                  <option key={m} value={m}>
                    {t(INTERPOLATION_LABELS[m])}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {format === "nifti" && suvCandidates.length > 0 && (
          <label className="checkbox-field">
            <input type="checkbox" checked={suv} disabled={working} onChange={(e) => setSuv(e.target.checked)} />
            PET-Werte als SUV speichern ({suvCandidates.map((i) => `${i.label}: × ${formatValue(i.suvFactor!)}`).join("; ")})
          </label>
        )}
        {format === "dicom" && anyEditedDicom && (
          <>
            <label className="checkbox-field">
              <input type="checkbox" checked={markSeries} disabled={working} onChange={(e) => setMarkSeries(e.target.checked)} />
              SeriesDescription um „[bearbeitet]“ ergänzen
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={adjustWindow} disabled={working} onChange={(e) => setAdjustWindow(e.target.checked)} />
              {t("Fensterwerte an neuen Wertebereich anpassen")}
            </label>
          </>
        )}

        <button className="primary-btn" disabled={working || chosen.length === 0 || !settings} onClick={() => void run()}>
          {working ? t("Export läuft …") : chosen.length > 1 ? t("{length} Datensätze exportieren (ZIP)", { length: chosen.length }) : "Exportieren"}
        </button>
        {status && <p className="tool-hint">{status}</p>}
        {messages.length > 0 && (
          <ul className="export-messages">
            {messages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
        {error && <div className="error-banner">{error}</div>}
      </Card>

      {format === "dicom" && anyDicomSource && (
        <section className="card">
          <label className="checkbox-field">
            <input type="checkbox" checked={anonymize} onChange={(e) => setAnonymize(e.target.checked)} />
            DICOM anonymisieren
          </label>
          {anonymize && (
            <>
              <label className="field">
                Pseudonym (Patientenname/-ID)
                <input type="text" value={pseudonym} onChange={(e) => setPseudonym(e.target.value)} />
              </label>
              <label className="checkbox-field">
                <input type="checkbox" checked={retainPatientChars} onChange={(e) => setRetainPatientChars(e.target.checked)} />
                Gewicht, Größe, Geschlecht, Alter behalten (für SUV)
              </label>
              <InfoText details={t("Entfernt bzw. geleert werden Patientendaten (Name, ID, Geburtsdatum, Adresse …), Betreiber (Institution, Abteilung, Ärzte, Bediener, Station), Gerät (Hersteller, Modell, Seriennummern, Software, Kalibrierung), Freitexte, Auftrags-/Referenz-Sequenzen und alle Private Tags. UIDs werden ersetzt, Dateien heißen IM00001.dcm usw. Datum und Uhrzeit bleiben erhalten (für Zerfallskorrektur/SUV). Eingebrannte Beschriftungen im Bild werden nicht erkannt.")}>
                {t("Patienten-, Geräte- und Freitextangaben werden entfernt.")}
              </InfoText>
            </>
          )}
          {!anonymize && <p className="export-note">{t("Ohne Anonymisierung bleiben alle Patientendaten aus dem Original-Header enthalten.")}</p>}
        </section>
      )}
    </div>
  );
}
