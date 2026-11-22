import { useRef } from "react";
import { Card } from "./Card";

import { t } from "../i18n";
import { T } from "../i18n/T";
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
    <Card title={<>{t("SPM / CAT12-Verformungsfeld")}</>} info={
          <>
            <T k="Ein in SPM (Segment/Normalise) oder CAT12 berechnetes Feld {c}y_*.nii{/c} des Subjekts übernehmen – anschließend lassen sich das T1 und alle dazu coregistrierten Datensätze (z. B. das PET) darüber in den Standardraum übertragen. Das Subjekt muss das Bild sein, auf dem SPM/CAT12 gerechnet hat (gleiche Orientierung im Header)." c={(x) => <code>{x}</code>} />
          </>
        } defaultOpen={false} persistKey="spm-field">
      <p className="tool-hint">
        <T k="Feld {c}y_*.nii{/c} aus SPM/CAT12 übernehmen." c={(x) => <code>{x}</code>} />
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
          {t("y_*.nii laden")}{props.subjectLabel ? t(" (für {subjectLabel})", { subjectLabel: props.subjectLabel }) : ""}
        </button>
        <button className="secondary-btn" disabled={props.busy || !props.canExport} onClick={props.onExport}>
          {t("Als y_*.nii speichern")}
        </button>
      </div>
      {props.status && <p className="tool-hint">{props.status}</p>}
    </Card>
  );
}
