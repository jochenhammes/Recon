import { useState } from "react";
import type { SegmentProgress } from "../segmentation/infer";
import type { Option } from "./NormalizationPanel";

export interface CtSegCardProps {
  cts: Option[];
  defaultCtId: string | null;
  running: boolean;
  progress: SegmentProgress | null;
  status: string | null;
  error: string | null;
  webgpu: boolean;
  onRun: (ctId: string, backend: "auto" | "wasm") => void;
  onCancel: () => void;
}

const fmtTime = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);

/** Whole-body CT organ segmentation in the browser (TotalSegmentator "total", 3 mm, ONNX). */
export function CtSegCard(props: CtSegCardProps) {
  const [ctId, setCtId] = useState<string | null>(null);
  const ct = props.cts.find((c) => c.id === ctId) ?? props.cts.find((c) => c.id === props.defaultCtId) ?? props.cts[0] ?? null;
  const p = props.progress;
  return (
    <section className="card">
      <h3>CT-Organsegmentierung</h3>
      <p className="hint">
        117 Strukturen (Organe, Knochen, Gefäße, Muskeln) mit TotalSegmentator „total“ (3 mm) direkt im Browser – die Daten verlassen den Rechner nicht.
        Das Modell (66 MB) wird beim ersten Mal geladen und im Browser gespeichert. Ergebnis: Label-Datensatz (Atlas) zum CT.
      </p>
      {props.cts.length === 0 ? (
        <p className="tool-hint">Kein CT geladen.</p>
      ) : (
        <>
          <label className="field">
            CT
            <select value={ct?.id ?? ""} disabled={props.running} onChange={(e) => setCtId(e.target.value)}>
              {props.cts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {!props.webgpu && (
            <p className="warning-banner">Kein WebGPU verfügbar: Die Berechnung läuft auf der CPU und kann für ein Ganzkörper-CT sehr lange dauern (Chrome/Edge mit aktueller Grafikkarte empfohlen).</p>
          )}
          {!props.running ? (
            <button className="primary-btn" disabled={!ct} onClick={() => ct && props.onRun(ct.id, "auto")}>
              Organe segmentieren
            </button>
          ) : (
            <>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${Math.round(p && p.total > 0 ? (100 * p.done) / p.total : 3)}%` }} />
              </div>
              <p className="tool-hint">
                {p
                  ? p.stage.startsWith("Inferenz")
                    ? `${p.stage} · Kachel ${Math.min(p.done + 1, p.total)}/${p.total}${p.elapsed !== undefined ? ` · ${fmtTime(p.elapsed)} vergangen` : ""}${p.remaining !== undefined ? ` · noch ca. ${fmtTime(p.remaining)}` : p.done === 0 ? " · erste Kachel dauert länger (Shader werden übersetzt)" : ""}`
                    : p.stage
                  : "Vorbereitung …"}
              </p>
              <button className="secondary-btn" onClick={props.onCancel}>
                Abbrechen
              </button>
            </>
          )}
        </>
      )}
      {props.status && <p className="tool-hint">{props.status}</p>}
      {props.error && <div className="error-banner">{props.error}</div>}
      <p className="tool-hint">
        Modell: TotalSegmentator (Wasserthal et al., Radiology: AI 2023), Apache-2.0; nnU-Net (Isensee et al. 2021). Nicht für diagnostische Zwecke zertifiziert.
      </p>
    </section>
  );
}
