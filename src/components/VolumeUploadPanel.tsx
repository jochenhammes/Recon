import { useRef, useState } from "react";
import { type LoadedVolume, VolumeLoadError, loadVolumeFromFiles, loadVolumesFromFiles } from "../viewer/volumeLoader";
import { droppedFiles } from "./droppedFiles";

import { t, tn } from "../i18n";
export interface VolumeUploadPanelProps {
  onLoaded: (loaded: LoadedVolume, fileName: string) => void;
  title?: string;
  description?: string;
  /** Load only one volume (largest series) instead of every series in the selection. */
  single?: boolean;
  /** Reports loading start/end (for the activity indicator). */
  onBusyChange?: (busy: boolean) => void;
  /** Small drop zone without heading (once data are loaded). */
  compact?: boolean;
  /** Called instead of loading when a project file (.recon) is dropped/selected. */
  onProjectFile?: (file: File) => void;
}

export function VolumeUploadPanel({ onLoaded, title = t("Volumen laden"), description, single, onBusyChange, compact, onProjectFile }: VolumeUploadPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const folderRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | File[] | null) {
    if (!fileList || fileList.length === 0) return;
    const project = Array.from(fileList).find((f) => /\.recon$/i.test(f.name));
    if (project && onProjectFile) {
      onProjectFile(project);
      return;
    }
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
        if (!items.length) throw new VolumeLoadError(t("Keine lesbaren Bilddaten gefunden") + (skipped.length ? ` (${t("{n} Datei(en) ignoriert", { n: skipped.length })})` : "") + ".");
        for (const it of items) onLoaded(it.loaded, items.length === 1 && folder ? `${folder} · ${it.name}` : it.name);
        if (items.length > 1 || skipped.length)
          setInfo(tn(items.length, "{n} Datensatz geladen", "{n} Datensätze (Serien) geladen") + (skipped.length ? t(", {n} nicht lesbare Datei(en) ignoriert", { n: skipped.length }) : "") + ".");
        return;
      }
      const loaded = await loadVolumeFromFiles(files);
      const count = loaded.source.kind === "dicom" ? loaded.source.files.length : files.length;
      const name = count === 1 && files.length === 1 ? files[0].name : folder ? t("{folder} ({count} Dateien)", { folder, count }) : t("{count} Dateien", { count });
      onLoaded(loaded, name);
    } catch (e) {
      setError(e instanceof VolumeLoadError ? e.message : t("Unerwarteter Fehler: {v}", { v: String(e) }));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div className={compact ? "upload-panel compact" : "upload-panel"}>
      <h3>{title}</h3>
      <p>{description ?? t("PET, SPECT oder CT als DICOM (Datei oder ganze Serie) bzw. NIfTI (.nii, .nii.gz).")}</p>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void droppedFiles(e.dataTransfer).then((f) => handleFiles(f));
        }}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? t("Wird geladen…") : compact ? t("+ Weitere Dateien (hierher ziehen oder klicken)") : t("Dateien oder Ordner hierher ziehen oder klicken")}
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
        {t("Ordner wählen (DICOM-Serie)")}
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
