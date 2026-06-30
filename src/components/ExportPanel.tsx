import type { ReconParams } from "../recon/volume";
import type { Volume3D } from "../viewer/volume";
import { buildReconstructionDicom } from "../export/dicomWriter";
import { buildNiftiFile } from "../export/niftiWriter";

export interface ExportPanelProps {
  volume: Volume3D;
  reconParams: ReconParams;
  sourceFileName: string;
}

const FILTER_LABELS: Record<string, string> = {
  ramp: "Ram-Lak",
  "shepp-logan": "Shepp-Logan",
  cosine: "Cosine",
  hamming: "Hamming",
  hann: "Hann",
};

function describeRecon(params: ReconParams): string {
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

export function ExportPanel({ volume, reconParams, sourceFileName }: ExportPanelProps) {
  const baseName = sourceFileName.replace(/\.[^./\\]+$/, "") || "recon";

  function handleExportDicom() {
    const bytes = buildReconstructionDicom(volume, { seriesDescription: describeRecon(reconParams) });
    downloadBytes(bytes, `${baseName}_recon.dcm`, "application/dicom");
  }

  function handleExportNifti() {
    const bytes = buildNiftiFile(volume);
    downloadBytes(bytes, `${baseName}_recon.nii`, "application/octet-stream");
  }

  return (
    <div className="export-panel">
      <h2>Export</h2>
      <button className="secondary-btn" onClick={handleExportDicom}>
        Als DICOM speichern
      </button>
      <button className="secondary-btn" onClick={handleExportNifti}>
        Als NIfTI speichern
      </button>
      <p className="export-note">
        Die exportierten Dateien enthalten keine Patientendaten – Name und ID sind anonymisiert. Gespeichert werden
        nur die rekonstruierten Bilddaten und die Voxelgeometrie.
      </p>
    </div>
  );
}
