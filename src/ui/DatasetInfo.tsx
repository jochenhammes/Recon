import { type ReactNode, useEffect, useState } from "react";
import type { LoadedDataset } from "../dataset/types";
import { MODALITIES, acquisitionTime, autoModality, formatAcquisitionTime, modalityLabel, modalityName, seriesDescription, shortName } from "../dataset/describe";

import { t } from "../i18n";
/** Details of a loaded dataset (modality, source, matrix, voxel size, geometry); shown when a list row is expanded. */
export interface DatasetDetailsProps {
  dataset: LoadedDataset;
  /** The user picks the modality (undefined = automatic: DICOM header, NIfTI guess, reconstruction = SPECT). */
  onModalityChange?: (modality: string | undefined) => void;
  /** New name (part of export file names); empty = original file name. */
  onNameChange?: (name: string) => void;
  /** Original name (file or series) for the hint below the name field. */
  originalName?: string;
  isBase?: boolean;
  onMakeBase?: () => void;
  /** Extra controls below the summary (e.g. tag input). */
  children?: ReactNode;
}

export function DatasetDetails({ dataset, onModalityChange, onNameChange, originalName, isBase, onMakeBase, children }: DatasetDetailsProps) {
  const v = dataset.current;
  const [sx, sy, sz] = v.geometry.spacing;
  const src = dataset.source;
  const acq = acquisitionTime(dataset);
  const files = src.kind === "dicom" ? `${src.files.length} ${src.files.length === 1 ? "Datei" : "Dateien"}` : src.kind === "nifti" ? "NIfTI" : "Rekonstruktion";
  return (
    <div className="dataset-details">
      <dl className="summary-list">
        <dt>{t("Bezeichnung")}</dt>
        <dd>
          {onNameChange ? (
            <NameField value={dataset.displayName} original={originalName} onCommit={onNameChange} />
          ) : (
            <span title={dataset.displayName}>{shortName(dataset.displayName)}</span>
          )}
        </dd>
        <dt>{t("Modalität")}</dt>
        <dd>
          {onModalityChange && !dataset.atlas && !dataset.template ? (
            <select
              className="inline-select"
              value={src.modality ?? ""}
              title={t("Modalität für Anzeige, Auswertung und Export – automatisch aus DICOM-Header bzw. Erkennung, oder hier wählen.")}
              onChange={(e) => onModalityChange(e.target.value || undefined)}
            >
              <option value="">{t("automatisch ({name})", { name: modalityName(autoModality(src)) })}</option>
              {MODALITIES.map((m) => (
                <option key={m.code} value={m.code}>
                  {t(m.label)}
                </option>
              ))}
            </select>
          ) : (
            <span className="badge">{modalityLabel(src)}</span>
          )}
          {dataset.kindLabel && <span className="row-note"> {dataset.kindLabel}</span>}
        </dd>
        {seriesDescription(src) && (
          <>
            <dt>{t("Serie")}</dt>
            <dd>{seriesDescription(src)}</dd>
          </>
        )}
        {acq && (
          <>
            <dt>{t("Aufnahme")}</dt>
            <dd className="wrap" title={acq.field === "Acquisition" ? t("Aufnahmedatum/-zeit aus dem DICOM-Header") : t("Kein Aufnahmezeitpunkt im Header – {v} angezeigt", { v: { Series: "Seriendatum/-zeit", Content: "Erstellungsdatum/-zeit", Study: "Studiendatum/-zeit" }[acq.field] })}>
              {formatAcquisitionTime(acq)}
              {acq.field !== "Acquisition" && <span className="row-note"> ({{ Series: "Serie", Content: "Erstellung", Study: "Studie" }[acq.field]})</span>}
            </dd>
          </>
        )}
        <dt>{t("Umfang")}</dt>
        <dd>{files}</dd>
        <dt>{t("Matrix")}</dt>
        <dd>
          {v.nx} × {v.ny} × {v.nz}
        </dd>
        <dt>{t("Voxel")}</dt>
        <dd>
          {sx.toFixed(2)} × {sy.toFixed(2)} × {sz.toFixed(2)} mm
        </dd>
        <dt>{t("Patientenkoordinaten")}</dt>
        <dd>{src.kind === "nifti" ? niftiPlacement(src.nifti.headerBytes, src.nifti.littleEndian) : v.hasPatientGeometry ? "vorhanden" : t("nicht bekannt")}</dd>
        <dt>{t("Ursprung")}</dt>
        <dd title={t("Weltkoordinaten (LPS, mm) des ersten Voxels")}>
          {v.geometry.origin.map((c) => c.toFixed(1)).join(" / ")} mm{dataset.reoriented ? t(" · neu gesetzt (Landmarke)") : ""}
        </dd>
        {dataset.dynamic && (
          <>
            <dt>{t("Dynamisch")}</dt>
            <dd>
              {dataset.dynamic.frames.length} Frames · {Math.round((dataset.dynamic.start.at(-1)! + dataset.dynamic.duration.at(-1)!) / 60)} min (angezeigt: Mittelbild)
            </dd>
          </>
        )}
        {dataset.edits.length > 0 && (
          <>
            <dt>{t("Bearbeitungen")}</dt>
            <dd>{dataset.edits.length}</dd>
          </>
        )}
      </dl>
      {onMakeBase && (
        <button className="secondary-btn" disabled={isBase} onClick={onMakeBase} title={t("Die Basis definiert den Raum der Ansicht; die anderen Datensätze werden darüber gezeigt.")}>
          {isBase ? t("Ist Basis der Ansicht") : t("Als Basis der Ansicht")}
        </button>
      )}
      {children}
    </div>
  );
}

/** Placement information of a NIfTI header: sform/qform codes (0 = not set → only voxel size, origin 0). */
function niftiPlacement(header: Uint8Array, le: boolean): string {
  if (header.length < 256) return t("nicht bekannt");
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const q = view.getInt16(252, le), s = view.getInt16(254, le);
  const code = (c: number) => ["unbekannt", "Scanner", "ausgerichtet", "Talairach", "MNI"][c] ?? String(c);
  if (s > 0) return `sform (${code(s)})${q > 0 ? `, qform (${code(q)})` : ""}`;
  if (q > 0) return `qform (${code(q)})`;
  return t("keine Lageangaben im NIfTI – nur Voxelgröße, Ursprung 0 (Landmarken setzen)");
}

/** Name field: applied on Enter or when leaving the field; empty → original name. */
function NameField({ value, original, onCommit }: { value: string; original?: string; onCommit: (name: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const v = text.trim();
    if (v !== value) onCommit(v);
  };
  return (
    <span className="name-field">
      <input
        type="text"
        value={text}
        title={t("Wird Teil der Exportdateinamen. Leer = Originalname.")}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setText(value);
        }}
      />
      {original && original !== value && <small className="muted" title={original}>Original: {shortName(original)}</small>}
    </span>
  );
}
