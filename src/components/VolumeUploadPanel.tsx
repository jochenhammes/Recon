import { useRef, useState } from "react";
import type { Volume3D } from "../viewer/volume";
import { VolumeLoadError, loadVolumeFromFiles } from "../viewer/volumeLoader";

export interface VolumeUploadPanelProps {
  onLoaded: (volume: Volume3D, fileName: string) => void;
}

export function VolumeUploadPanel({ onLoaded }: VolumeUploadPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const files = Array.from(fileList);
      const volume = await loadVolumeFromFiles(files);
      const name = files.length === 1 ? files[0].name : `${files.length} Dateien`;
      onLoaded(volume, name);
    } catch (e) {
      setError(e instanceof VolumeLoadError ? e.message : `Unerwarteter Fehler: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload-panel">
      <h2>Rekonstruiertes Volumen laden</h2>
      <p>NIfTI (.nii, .nii.gz) oder rekonstruiertes DICOM – einzeln oder als Serie.</p>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Wird geladen…" : "Dateien hierher ziehen oder klicken"}
        <input
          ref={inputRef}
          type="file"
          accept=".nii,.nii.gz,.dcm,application/dicom"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
