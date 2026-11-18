import { useRef, useState } from "react";
import { type LoadedVolume, VolumeLoadError, loadVolumeFromFiles, loadVolumesFromFiles } from "../viewer/volumeLoader";
import { droppedFiles } from "./droppedFiles";

export interface VolumeUploadPanelProps {
  onLoaded: (loaded: LoadedVolume, fileName: string) => void;
  title?: string;
  description?: string;
  /** Load only one volume (largest series) instead of every series in the selection. */
  single?: boolean;
  /** Reports loading start/end (for the activity indicator). */
  onBusyChange?: (busy: boolean) => void;
}

export function VolumeUploadPanel({ onLoaded, title = "Volumen laden", description, single, onBusyChange }: VolumeUploadPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const folderRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | File[] | null) {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    setInfo(null);
    try {
      // Hidden files (macOS .DS_Store, ._* resource forks) are never image data.
      const files = Array.from(fileList).filter((f) => !f.name.startsWith("."));
      const folder = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0];
      if (!single) {
        // Every series becomes its own dataset; unreadable files are ignored.
        const { items, skipped } = await loadVolumesFromFiles(files);
        if (!items.length) throw new VolumeLoadError(`Keine lesbaren Bilddaten gefunden${skipped.length ? ` (${skipped.length} Datei(en) ignoriert)` : ""}.`);
        for (const it of items) onLoaded(it.loaded, items.length === 1 && folder ? `${folder} · ${it.name}` : it.name);
        if (items.length > 1 || skipped.length)
          setInfo(`${items.length} ${items.length === 1 ? "Datensatz" : "Datensätze (Serien)"} geladen${skipped.length ? `, ${skipped.length} nicht lesbare Datei(en) ignoriert` : ""}.`);
        return;
      }
      const loaded = await loadVolumeFromFiles(files);
      const count = loaded.source.kind === "dicom" ? loaded.source.files.length : files.length;
      const name = count === 1 && files.length === 1 ? files[0].name : folder ? `${folder} (${count} Dateien)` : `${count} Dateien`;
      onLoaded(loaded, name);
    } catch (e) {
      setError(e instanceof VolumeLoadError ? e.message : `Unerwarteter Fehler: ${String(e)}`);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="upload-panel">
      <h3>{title}</h3>
      <p>{description ?? "PET, SPECT oder CT als DICOM (Datei oder ganze Serie) bzw. NIfTI (.nii, .nii.gz)."}</p>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void droppedFiles(e.dataTransfer).then((f) => handleFiles(f));
        }}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Wird geladen…" : "Dateien oder Ordner hierher ziehen oder klicken"}
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <button className="link-btn" disabled={busy} onClick={() => folderRef.current?.click()}>
        Ordner wählen (DICOM-Serie)
      </button>
      <input
        ref={folderRef}
        type="file"
        hidden
        multiple
        {...{ webkitdirectory: "", directory: "" }}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {info && <p className="tool-hint">{info}</p>}
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
