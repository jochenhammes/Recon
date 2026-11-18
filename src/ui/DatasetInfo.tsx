import { X } from "lucide-react";
import type { ReactNode } from "react";
import type { LoadedDataset } from "../dataset/types";
import { modalityLabel, seriesDescription } from "../dataset/describe";

/** Compact description of a loaded dataset (source, matrix, voxel size, geometry). */
export interface DatasetInfoProps {
  dataset: LoadedDataset;
  title: ReactNode;
  onRemove?: () => void;
  /** Extra controls below the summary (e.g. role buttons). */
  children?: ReactNode;
  highlighted?: boolean;
}

export function DatasetInfo({ dataset, title, onRemove, children, highlighted }: DatasetInfoProps) {
  const v = dataset.current;
  const [sx, sy, sz] = v.geometry.spacing;
  const src = dataset.source;
  const files = src.kind === "dicom" ? `${src.files.length} ${src.files.length === 1 ? "Datei" : "Dateien"}` : src.kind === "nifti" ? "NIfTI" : "Rekonstruktion";
  return (
    <section className={highlighted ? "card highlighted" : "card"}>
      <div className="layer-head">
        <h3>{title}</h3>
        {onRemove && (
          <button className="icon-btn small" title="Datensatz schließen" aria-label="Datensatz schließen" onClick={onRemove}>
            <X size={14} />
          </button>
        )}
      </div>
      <dl className="summary-list">
        <dt>Modalität</dt>
        <dd>
          <span className="badge">{modalityLabel(src)}</span>
        </dd>
        <dt>Quelle</dt>
        <dd title={dataset.displayName}>{dataset.displayName}</dd>
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
    </section>
  );
}
