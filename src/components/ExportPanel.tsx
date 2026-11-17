import { useState } from "react";
import type { WorldToVoxel } from "../core/geometry";
import type { LoadedDataset } from "../dataset/types";
import { modalityLabel } from "../dataset/describe";
import type { ReconParams } from "../recon/volume";
import { changesGrid, describeEdit } from "../edit/operations";
import type { AnonymizeOptions } from "../export/anonymize";
import { buildReconstructionDicom } from "../export/dicomWriter";
import { type ExportedFile, buildEditedDicomFiles } from "../export/editedDicomExport";
import { buildNiftiFile, buildNiftiFromOriginalHeader } from "../export/niftiWriter";
import { buildTemplateSeries } from "../export/templateDicomWriter";
import { buildZip } from "../export/zip";
import { resampleInto } from "../resample/resample";

export interface FusionExportSource {
  functional: LoadedDataset;
  anatomical: LoadedDataset;
  /** Functional world→voxel transform including the manual registration. */
  functionalW2v: WorldToVoxel;
}

export interface ExportPanelProps {
  dataset: LoadedDataset;
  fusion?: FusionExportSource;
}

const FILTER_LABELS: Record<string, string> = {
  ramp: "Ram-Lak",
  "shepp-logan": "Shepp-Logan",
  cosine: "Cosine",
  hamming: "Hamming",
  hann: "Hann",
  "hann-half": "Hann ×0,5",
  butterworth: "Butterworth",
};

function describeRecon(params: ReconParams | undefined): string {
  if (!params) return "SPECT-Rekonstruktion";
  return params.algorithm === "fbp"
    ? `FBP (${FILTER_LABELS[params.filterType] ?? params.filterType})`
    : `OSEM (${params.numSubsets} Subsets, ${params.numIterations} Iterationen)`;
}

function safeFileName(s: string): string {
  return s.trim().replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function downloadBytes(bytes: Uint8Array<ArrayBuffer>, fileName: string, mimeType: string) {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadFiles(files: ExportedFile[], base: string) {
  if (files.length === 1) downloadBytes(files[0].bytes, `${base}.dcm`, "application/dicom");
  else downloadBytes(buildZip(files), `${base}.zip`, "application/zip");
}

export function ExportPanel({ dataset, fusion }: ExportPanelProps) {
  const { source, current: volume, edits } = dataset;
  const [markSeries, setMarkSeries] = useState(true);
  const [adjustWindow, setAdjustWindow] = useState(true);
  const [anonymize, setAnonymize] = useState(false);
  const [pseudonym, setPseudonym] = useState("ANONYM");
  const [retainPatientChars, setRetainPatientChars] = useState(true);
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const edited = edits.length > 0;
  const gridChanged = edits.some(changesGrid);
  const baseName = dataset.displayName.replace(/\.nii(\.gz)?$/i, "").replace(/\.[^./\\]+$/, "") || "volume";
  const suffix = source.kind === "reconstruction" ? (edited ? "_recon_edited" : "_recon") : edited ? "_edited" : "_export";
  const editDescription = edits.map((e) => describeEdit(e)).join("; ");
  const anonOptions: AnonymizeOptions | undefined = anonymize ? { pseudonym, retainPatientCharacteristics: retainPatientChars } : undefined;
  const outBase = anonymize ? `${safeFileName(pseudonym) || "ANONYM"}${edited ? "_edited" : ""}` : `${safeFileName(baseName)}${suffix}`;

  function run(action: () => string[]) {
    setError(null);
    setWorking(true);
    // Let the "läuft" state render before the (synchronous) export work starts.
    setTimeout(() => {
      try {
        const msgs = action();
        setMessages(msgs.length > 5 ? [...msgs.slice(0, 4), `… und ${msgs.length - 4} weitere Hinweise`] : msgs);
      } catch (e) {
        setMessages([]);
        setError(`Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setWorking(false);
      }
    }, 30);
  }

  function exportDicom() {
    run(() => {
      if (source.kind === "dicom" && !gridChanged) {
        const { files, warnings } = buildEditedDicomFiles(volume, source, {
          seriesDescriptionSuffix: markSeries && edited ? " [bearbeitet]" : undefined,
          derivationDescription: edited ? editDescription : undefined,
          adjustWindow: edited && adjustWindow,
          anonymize: anonOptions,
          headerEdits: dataset.headerEdits,
        });
        downloadFiles(files, outBase);
        return warnings;
      }
      if (source.kind === "dicom") {
        const { files, warnings } = buildTemplateSeries(volume, source.files[0], {
          seriesDescription: `${source.files[0].dataSet.string("x0008103e")?.trim() ?? ""} [bearbeitet]`.trim(),
          derivationDescription: editDescription,
          anonymize: anonOptions,
          headerEdits: dataset.headerEdits,
        });
        downloadFiles(files, outBase);
        return ["Neue Serie mit verändertem Voxelraster auf Basis des Original-Headers erzeugt.", ...warnings];
      }
      const description = source.kind === "reconstruction" ? describeRecon(source.reconParams) : `NIfTI-Import ${dataset.displayName}`;
      const bytes = buildReconstructionDicom(volume, {
        seriesDescription: edited ? `${description} [bearbeitet]`.slice(0, 64) : description,
      });
      downloadBytes(bytes, `${outBase}.dcm`, "application/dicom");
      return [];
    });
  }

  function exportNifti() {
    run(() => {
      if (source.kind === "nifti" && !gridChanged) {
        const bytes = buildNiftiFromOriginalHeader(volume, source.nifti);
        if (bytes) {
          downloadBytes(bytes, `${outBase}.nii`, "application/octet-stream");
          return ["Original-NIfTI-Header übernommen, Datentyp float32."];
        }
      }
      downloadBytes(buildNiftiFile(volume), `${outBase}.nii`, "application/octet-stream");
      return [];
    });
  }

  function fusedVolume() {
    if (!fusion) throw new Error("Keine Fusion geladen.");
    const target = fusion.anatomical.current;
    return target.withData(resampleInto(fusion.functional.current, fusion.functionalW2v, target, "linear"));
  }

  function exportFusionDicom() {
    run(() => {
      if (!fusion || fusion.functional.source.kind !== "dicom") throw new Error("DICOM-Fusionsexport benötigt ein PET/SPECT aus DICOM.");
      const resampled = fusedVolume();
      const { files, warnings } = buildTemplateSeries(resampled, fusion.functional.source.files[0], {
        seriesDescription: `${modalityLabel(fusion.functional.source)} auf CT-Raster`,
        derivationDescription: `Auf das Voxelraster des CT resampelt${fusion.functional.edits.length ? `; ${fusion.functional.edits.map((e) => describeEdit(e)).join("; ")}` : ""}`,
        frameOfReferenceUid: fusion.anatomical.current.geometry.frameOfReferenceUid,
        anonymize: anonOptions,
        headerEdits: fusion.functional.headerEdits,
      });
      downloadFiles(files, `${outBase}_auf_CT`);
      return [`${files.length} Schichten auf dem CT-Raster (${resampled.nx} × ${resampled.ny} × ${resampled.nz}).`, ...warnings];
    });
  }

  function exportFusionNifti() {
    run(() => {
      downloadBytes(buildNiftiFile(fusedVolume()), `${outBase}_auf_CT.nii`, "application/octet-stream");
      return [];
    });
  }

  const dicomLabel =
    source.kind === "dicom"
      ? gridChanged
        ? "Als neue DICOM-Serie speichern"
        : source.files.length > 1
          ? `Als DICOM-Serie speichern (ZIP, ${source.files.length} Dateien)`
          : "Als DICOM speichern (Original-Header)"
      : "Als DICOM speichern";

  return (
    <div className="export-panel">
      <section className="card">
        <h3>Datensatz · {modalityLabel(source)}</h3>
        <button className="secondary-btn" disabled={working} onClick={exportDicom}>
          {dicomLabel}
        </button>
        <button className="secondary-btn" disabled={working} onClick={exportNifti}>
          {source.kind === "nifti" && !gridChanged ? "Als NIfTI speichern (Original-Header)" : "Als NIfTI speichern"}
        </button>
        {source.kind === "dicom" && edited && !gridChanged && (
          <>
            <label className="checkbox-field">
              <input type="checkbox" checked={markSeries} onChange={(e) => setMarkSeries(e.target.checked)} />
              SeriesDescription um „[bearbeitet]“ ergänzen
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={adjustWindow} onChange={(e) => setAdjustWindow(e.target.checked)} />
              Fensterwerte an neuen Wertebereich anpassen
            </label>
          </>
        )}
        <p className="export-note">
          {source.kind === "dicom"
            ? gridChanged
              ? "Das Voxelraster wurde verändert: Es entsteht eine neue Serie mit angepasster Geometrie; alle übrigen Header-Daten werden aus dem Original übernommen."
              : "Alle Header-Daten des Originals werden unverändert übernommen. Neu vergeben werden SOP- und Series-Instance-UID; ImageType wird DERIVED, Fenster und Pixelwert-Grenzen werden angepasst."
            : "DICOM-Export ohne Original-Header: anonymisiertes Secondary-Capture-Bild mit Voxelgeometrie."}
        </p>
      </section>

      {fusion && (
        <section className="card">
          <h3>Fusion · {modalityLabel(fusion.functional.source)} auf CT-Raster</h3>
          <p className="export-note">
            {modalityLabel(fusion.functional.source)} inkl. Bearbeitungen und manueller Registrierung auf das Voxelraster des CT resampelt (
            {fusion.anatomical.current.nx} × {fusion.anatomical.current.ny} × {fusion.anatomical.current.nz}).
          </p>
          <button className="secondary-btn" disabled={working || fusion.functional.source.kind !== "dicom"} onClick={exportFusionDicom}>
            Als DICOM-Serie speichern
          </button>
          <button className="secondary-btn" disabled={working} onClick={exportFusionNifti}>
            Als NIfTI speichern
          </button>
        </section>
      )}

      {(source.kind === "dicom" || fusion?.functional.source.kind === "dicom") && (
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
              <p className="export-note">
                Entfernt bzw. geleert werden Patientendaten (Name, ID, Geburtsdatum, Adresse …), Betreiber (Institution, Abteilung,
                Ärzte, Bediener, Station), Gerät (Hersteller, Modell, Seriennummern, Software, Kalibrierung), Freitexte, Auftrags-/
                Referenz-Sequenzen und alle Private Tags. UIDs werden ersetzt, Dateien heißen IM00001.dcm usw. Datum und Uhrzeit bleiben
                erhalten (für Zerfallskorrektur/SUV). Eingebrannte Beschriftungen im Bild werden nicht erkannt.
              </p>
            </>
          )}
          {!anonymize && <p className="export-note">Ohne Anonymisierung bleiben alle Patientendaten aus dem Original-Header enthalten.</p>}
        </section>
      )}

      {working && <p className="tool-hint">Export läuft …</p>}
      {messages.length > 0 && (
        <ul className="export-messages">
          {messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
