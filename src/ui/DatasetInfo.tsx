import type { ReactNode } from "react";
import type { LoadedDataset } from "../dataset/types";
import { NIFTI_MODALITIES, modalityLabel, seriesDescription, shortName } from "../dataset/describe";

/** Details of a loaded dataset (modality, source, matrix, voxel size, geometry); shown when a list row is expanded. */
export interface DatasetDetailsProps {
  dataset: LoadedDataset;
  /** NIfTI: the user picks the modality (undefined = keep the automatic guess). */
  onModalityChange?: (modality: string | undefined) => void;
  /** Extra controls below the summary (e.g. tag input). */
  children?: ReactNode;
}

export function DatasetDetails({ dataset, onModalityChange, children }: DatasetDetailsProps) {
  const v = dataset.current;
  const [sx, sy, sz] = v.geometry.spacing;
  const src = dataset.source;
  const files = src.kind === "dicom" ? `${src.files.length} ${src.files.length === 1 ? "Datei" : "Dateien"}` : src.kind === "nifti" ? "NIfTI" : "Rekonstruktion";
  return (
    <div className="dataset-details">
      <dl className="summary-list">
        <dt>Modalität</dt>
        <dd>
          {src.kind === "nifti" && onModalityChange && !dataset.atlas && !dataset.template ? (
            <select
              className="inline-select"
              value={src.modality ?? ""}
              title="NIfTI-Dateien enthalten keine Modalität – automatisch erkannt (Dateiname, BIDS-JSON, Wertebereich) oder hier wählen."
              onChange={(e) => onModalityChange(e.target.value || undefined)}
            >
              <option value="">automatisch ({NIFTI_MODALITIES.find((m) => m.code === (src.modalityGuess ?? "NIfTI"))?.label ?? src.modalityGuess})</option>
              {NIFTI_MODALITIES.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="badge">{modalityLabel(src)}</span>
          )}
        </dd>
        <dt>Quelle</dt>
        <dd title={dataset.displayName}>{shortName(dataset.displayName)}</dd>
        {seriesDescription(src) && (
          <>
            <dt>Serie</dt>
            <dd>{seriesDescription(src)}</dd>
          </>
        )}
        <dt>Umfang</dt>
        <dd>{files}</dd>
        <dt>Matrix</dt>
        <dd>
          {v.nx} × {v.ny} × {v.nz}
        </dd>
        <dt>Voxel</dt>
        <dd>
          {sx.toFixed(2)} × {sy.toFixed(2)} × {sz.toFixed(2)} mm
        </dd>
        <dt>Patientenkoordinaten</dt>
        <dd>{v.hasPatientGeometry ? "vorhanden" : "nicht bekannt"}</dd>
        {dataset.dynamic && (
          <>
            <dt>Dynamisch</dt>
            <dd>
              {dataset.dynamic.frames.length} Frames · {Math.round((dataset.dynamic.start.at(-1)! + dataset.dynamic.duration.at(-1)!) / 60)} min (angezeigt: Mittelbild)
            </dd>
          </>
        )}
        {dataset.edits.length > 0 && (
          <>
            <dt>Bearbeitungen</dt>
            <dd>{dataset.edits.length}</dd>
          </>
        )}
      </dl>
      {children}
    </div>
  );
}
