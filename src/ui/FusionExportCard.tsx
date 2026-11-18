import { useState } from "react";
import { CardTitle } from "./Info";

export type FusionGridMode = "base" | "axial";
export type FusionFormat = "dicom" | "nifti";

export interface FusionExportCardProps {
  /** Visible layers, bottom first (as they will be composited). */
  layerLabels: string[];
  baseLabel: string;
  canDicomMeta: boolean;
  busy: boolean;
  status: string | null;
  onExport: (format: FusionFormat, grid: FusionGridMode, anonymize: boolean) => void;
}

/** Exports the current view (visible layers with their windows, color tables and opacities) as RGB dataset. */
export function FusionExportCard(props: FusionExportCardProps) {
  const [format, setFormat] = useState<FusionFormat>("dicom");
  const [grid, setGrid] = useState<FusionGridMode>("base");
  const [anonymize, setAnonymize] = useState(true);
  return (
    <section className="card">
      <CardTitle info="Die sichtbaren Ebenen werden mit ihren aktuellen Fenstern, Farbtabellen und Deckkräften zu einem RGB-Datensatz verrechnet.">Fusion exportieren</CardTitle>
      <p className="tool-hint">Ebenen (unten → oben): {props.layerLabels.join(" → ") || "–"}</p>
      <label className="field">
        Raster
        <select value={grid} onChange={(e) => setGrid(e.target.value as FusionGridMode)}>
          <option value="base">wie Basis ({props.baseLabel})</option>
          <option value="axial">axial, an den Patientenachsen ausgerichtet</option>
        </select>
      </label>
      <label className="field">
        Format
        <select value={format} onChange={(e) => setFormat(e.target.value as FusionFormat)}>
          <option value="dicom">DICOM RGB (Secondary Capture, eine Datei je Schicht, ZIP)</option>
          <option value="nifti">NIfTI RGB24</option>
        </select>
      </label>
      {format === "dicom" && (
        <label className="checkbox-field">
          <input type="checkbox" checked={anonymize} onChange={(e) => setAnonymize(e.target.checked)} disabled={!props.canDicomMeta} />
          anonymisieren{props.canDicomMeta ? " (sonst Patient/Studie der Basis übernehmen)" : " (Basis ist kein DICOM)"}
        </label>
      )}
      <button className="primary-btn" disabled={props.busy || props.layerLabels.length === 0} onClick={() => props.onExport(format, grid, anonymize || !props.canDicomMeta)}>
        {props.busy ? "Wird erstellt …" : "Fusion exportieren"}
      </button>
      {props.status && <p className="tool-hint">{props.status}</p>}
    </section>
  );
}
