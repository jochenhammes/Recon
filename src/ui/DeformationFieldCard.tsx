import { useRef } from "react";

export interface DeformationFieldCardProps {
  subjectLabel: string | null;
  canExport: boolean;
  busy: boolean;
  onImport: (file: File) => void;
  onExport: () => void;
  status: string | null;
}

/** Import/export of SPM / CAT12 deformation fields (y_*.nii). */
export function DeformationFieldCard(props: DeformationFieldCardProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className="card">
      <h3>SPM / CAT12-Verformungsfeld</h3>
      <p className="hint">
        Ein in SPM (Segment/Normalise) oder CAT12 berechnetes Feld <code>y_*.nii</code> des Subjekts übernehmen – anschließend lassen sich das T1 und
        alle dazu coregistrierten Datensätze (z. B. das PET) darüber in den Standardraum übertragen. Das Subjekt muss das Bild sein, auf dem SPM/CAT12
        gerechnet hat (gleiche Orientierung im Header).
      </p>
      <input
        ref={input}
        type="file"
        accept=".nii,.gz"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) props.onImport(f);
          e.target.value = "";
        }}
      />
      <div className="button-row">
        <button className="secondary-btn" disabled={props.busy || !props.subjectLabel} onClick={() => input.current?.click()}>
          y_*.nii laden{props.subjectLabel ? ` (für ${props.subjectLabel})` : ""}
        </button>
        <button className="secondary-btn" disabled={props.busy || !props.canExport} onClick={props.onExport}>
          Als y_*.nii speichern
        </button>
      </div>
      {props.status && <p className="tool-hint">{props.status}</p>}
    </section>
  );
}
