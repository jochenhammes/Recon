import { useRef, useState } from "react";
import { DicomParseError, mergeProjectionSets, parseSpectDicom } from "../dicom/parse";
import type { SpectProjectionSet } from "../dicom/types";

export interface UploadPanelProps {
  onLoaded: (projectionSet: SpectProjectionSet) => void;
}

export function UploadPanel({ onLoaded }: UploadPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const files = Array.from(fileList);
      const sets = await Promise.all(
        files.map(async (file) => parseSpectDicom(await file.arrayBuffer(), file.name)),
      );
      const merged = mergeProjectionSets(sets);
      onLoaded(merged);
    } catch (e) {
      setError(e instanceof DicomParseError ? e.message : `Unerwarteter Fehler: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload-panel">
      <h2>SPECT-Rohdaten hochladen</h2>
      <p>
        Multi-Frame DICOM-Datei (Modality NM) mit den Projektionen beider Detektorköpfe. Falls jeder Kopf als
        eigene Datei exportiert wurde, können auch zwei Dateien gleichzeitig ausgewählt werden.
      </p>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Wird verarbeitet…" : "Dateien hierher ziehen oder klicken, um auszuwählen"}
        <input
          ref={inputRef}
          type="file"
          accept=".dcm,application/dicom"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
