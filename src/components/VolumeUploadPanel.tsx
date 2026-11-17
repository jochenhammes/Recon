import { useRef, useState } from "react";
import { type LoadedVolume, VolumeLoadError, loadVolumeFromFiles } from "../viewer/volumeLoader";

export interface VolumeUploadPanelProps {
  onLoaded: (loaded: LoadedVolume, fileName: string) => void;
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
      const loaded = await loadVolumeFromFiles(files);
      const name = files.length === 1 ? files[0].name : `${files.length} Dateien`;
      onLoaded(loaded, name);
    } catch (e) {
      setError(e instanceof VolumeLoadError ? e.message : `Unerwarteter Fehler: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload-panel">
      <h3>Volumen laden</h3>
      <p>PET, SPECT oder CT als DICOM (Datei oder ganze Serie) bzw. NIfTI (.nii, .nii.gz).</p>
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
