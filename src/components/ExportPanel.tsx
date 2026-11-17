import { useState } from "react";
import type { LoadedDataset } from "../dataset/types";
import type { ReconParams } from "../recon/volume";
import { describeEdit } from "../edit/operations";
import { buildReconstructionDicom } from "../export/dicomWriter";
import { buildEditedDicomFiles } from "../export/editedDicomExport";
import { buildNiftiFile, buildNiftiFromOriginalHeader } from "../export/niftiWriter";
import { buildZip } from "../export/zip";

export interface ExportPanelProps {
  dataset: LoadedDataset;
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

export function ExportPanel({ dataset }: ExportPanelProps) {
  const { source, current: volume, edits } = dataset;
  const [markSeries, setMarkSeries] = useState(true);
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const edited = edits.length > 0;
  const baseName = dataset.displayName.replace(/\.nii(\.gz)?$/i, "").replace(/\.[^./\\]+$/, "") || "volume";
  const suffix = source.kind === "reconstruction" ? (edited ? "_recon_edited" : "_recon") : edited ? "_edited" : "_export";
  const editDescription = edits.map(describeEdit).join("; ");

  function run(action: () => string[]) {
    setError(null);
    try {
      const msgs = action();
      setMessages(msgs.length > 5 ? [...msgs.slice(0, 4), `… und ${msgs.length - 4} weitere Hinweise`] : msgs);
    } catch (e) {
      setMessages([]);
      setError(`Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function exportDicom() {
    run(() => {
      if (source.kind === "dicom") {
        const { files, warnings } = buildEditedDicomFiles(volume, source, {
          seriesDescriptionSuffix: markSeries && edited ? " [bearbeitet]" : undefined,
          derivationDescription: edited ? editDescription : undefined,
        });
        if (files.length === 1) downloadBytes(files[0].bytes, `${baseName}${suffix}.dcm`, "application/dicom");
        else downloadBytes(buildZip(files), `${baseName}${suffix}.zip`, "application/zip");
        return warnings;
      }
      const description =
        source.kind === "reconstruction" ? describeRecon(source.reconParams) : `NIfTI-Import ${dataset.displayName}`;
      const bytes = buildReconstructionDicom(volume, {
        seriesDescription: edited ? `${description} [bearbeitet]`.slice(0, 64) : description,
      });
      downloadBytes(bytes, `${baseName}${suffix}.dcm`, "application/dicom");
      return [];
    });
  }

  function exportNifti() {
    run(() => {
      if (source.kind === "nifti") {
        const bytes = buildNiftiFromOriginalHeader(volume, source.nifti);
        if (bytes) {
          downloadBytes(bytes, `${baseName}${suffix}.nii`, "application/octet-stream");
          return ["Original-NIfTI-Header übernommen, Datentyp float32."];
        }
        downloadBytes(buildNiftiFile(volume), `${baseName}${suffix}.nii`, "application/octet-stream");
        return ["Big-Endian-Original: neuer Header erzeugt (Orientierung nicht übernommen)."];
      }
      downloadBytes(buildNiftiFile(volume), `${baseName}${suffix}.nii`, "application/octet-stream");
      return [];
    });
  }

  return (
    <div className="export-panel">
      <h2>Export</h2>
      <button className="secondary-btn" onClick={exportDicom}>
        {source.kind === "dicom"
          ? source.files.length > 1
            ? `Als DICOM-Serie speichern (ZIP, ${source.files.length} Dateien)`
            : "Als DICOM speichern (Original-Header)"
          : "Als DICOM speichern"}
      </button>
      <button className="secondary-btn" onClick={exportNifti}>
        {source.kind === "nifti" ? "Als NIfTI speichern (Original-Header)" : "Als NIfTI speichern"}
      </button>
      {source.kind === "dicom" && edited && (
        <label className="checkbox-field">
          <input type="checkbox" checked={markSeries} onChange={(e) => setMarkSeries(e.target.checked)} />
          SeriesDescription um „[bearbeitet]“ ergänzen
        </label>
      )}
      <p className="export-note">
        {source.kind === "dicom"
          ? "DICOM-Export übernimmt alle Header-Daten des Originals unverändert – inklusive Patientendaten. " +
            "Neu vergeben werden nur SOP- und Series-Instance-UID; ImageType wird auf DERIVED gesetzt."
          : "Die exportierten DICOM-Dateien enthalten keine Patientendaten – Name und ID sind anonymisiert. " +
            "Gespeichert werden nur die Bilddaten und die Voxelgeometrie."}
      </p>
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
