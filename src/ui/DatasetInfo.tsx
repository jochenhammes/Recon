import type { LoadedDataset } from "../dataset/types";
import { modalityLabel, seriesDescription } from "../dataset/describe";

/** Compact description of a loaded dataset (source, matrix, voxel size, geometry). */
export function DatasetInfo({ dataset, title }: { dataset: LoadedDataset; title: string }) {
  const v = dataset.current;
  const [sx, sy, sz] = v.geometry.spacing;
  const src = dataset.source;
  const files = src.kind === "dicom" ? `${src.files.length} ${src.files.length === 1 ? "Datei" : "Dateien"}` : src.kind === "nifti" ? "NIfTI" : "Rekonstruktion";
  return (
    <section className="card">
      <h3>{title}</h3>
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
        {dataset.edits.length > 0 && (
          <>
            <dt>Bearbeitungen</dt>
            <dd>{dataset.edits.length}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
