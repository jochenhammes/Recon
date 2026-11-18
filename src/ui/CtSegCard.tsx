import { useEffect, useState } from "react";
import { tileTimeLimitSec } from "../segmentation/ctSegment";
import { type SegmentProgress, inferenceEstimate } from "../segmentation/infer";
import type { CtSegBackend } from "../workers/ctseg.worker";
import type { Option } from "./NormalizationPanel";

export interface CtSegCardProps {
  cts: Option[];
  defaultCtId: string | null;
  running: boolean;
  progress: SegmentProgress | null;
  status: string | null;
  error: string | null;
  webgpu: boolean;
  onRun: (ctId: string, backend: CtSegBackend) => void;
  onCancel: () => void;
}

const fmtTime = (sec: number) => {
  const s = Math.round(sec);
  return s < 90 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

const BACKEND_KEY = "recon-studio-ctseg-backend";
const firefox = typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent);


/** Whole-body CT organ segmentation in the browser (TotalSegmentator "total", 3 mm, ONNX). */
export function CtSegCard(props: CtSegCardProps) {
  const [ctId, setCtId] = useState<string | null>(null);
  const ct = props.cts.find((c) => c.id === ctId) ?? props.cts.find((c) => c.id === props.defaultCtId) ?? props.cts[0] ?? null;
  const p = props.progress;
  const [backend, setBackend] = useState<CtSegBackend>(() => {
    try {
      const v = localStorage.getItem(BACKEND_KEY);
      return v === "webgpu" || v === "wasm" ? v : "auto";
    } catch {
      return "auto";
    }
  });
  const chooseBackend = (b: CtSegBackend) => {
    setBackend(b);
    try {
      localStorage.setItem(BACKEND_KEY, b);
    } catch {
      /* not remembered */
    }
  };
  // Clock for the progress within a tile.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!props.running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [props.running]);
  const inference = p?.stage.startsWith("Inferenz") ? inferenceEstimate(p, now) : null;
  const pct = inference ? 100 * inference.fraction : p && p.total > 0 ? (100 * p.done) / p.total : 3;
  const slow = inference && p && inference.avg && inference.since > 3 * inference.avg;
  const autoText = props.webgpu ? (firefox ? "Automatisch (Firefox: CPU)" : "Automatisch (WebGPU)") : "Automatisch (CPU)";
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
          <label className="field">
            Berechnung
            <select value={backend} disabled={props.running} onChange={(e) => chooseBackend(e.target.value as CtSegBackend)}>
              <option value="auto">{autoText}</option>
              <option value="webgpu" disabled={!props.webgpu}>
                WebGPU (Grafikkarte){props.webgpu ? "" : " – nicht verfügbar"}
              </option>
              <option value="wasm">CPU</option>
            </select>
          </label>
          <p className="tool-hint">
            WebGPU ist meist deutlich schneller. Hängt WebGPU oder meldet einen Fehler, wird automatisch auf der CPU weitergerechnet.
            {firefox && " In Firefox ist WebGPU mit dem Modell noch unzuverlässig – „Automatisch“ nutzt daher die CPU."}
          </p>
          {!props.webgpu && (
            <p className="warning-banner">Kein WebGPU verfügbar: Die Berechnung läuft auf der CPU und kann für ein Ganzkörper-CT sehr lange dauern (Chrome/Edge mit aktueller Grafikkarte empfohlen).</p>
          )}
          {!props.running ? (
            <button className="primary-btn" disabled={!ct} onClick={() => ct && props.onRun(ct.id, backend)}>
              Organe segmentieren
            </button>
          ) : (
            <>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${Math.max(2, Math.round(pct))}%` }} />
              </div>
              <div className="progress-label">{Math.round(pct)} %</div>
              {p?.note && <p className="warning-banner">{p.note}</p>}
              <p className="tool-hint">
                {p && inference
                  ? `${p.stage} · Kachel ${Math.min(p.done + 1, p.total)}/${p.total}` +
                    (p.done < p.total ? ` läuft seit ${fmtTime(inference.since)}${inference.avg ? ` (bisher Ø ${fmtTime(inference.avg)})` : ""}` : "") +
                    ` · ${fmtTime(inference.elapsed)} vergangen` +
                    (inference.remaining !== undefined ? ` · noch ca. ${fmtTime(inference.remaining)}` : p.done === 0 && p.backend === "webgpu" ? " · die erste Kachel dauert länger (Shader werden übersetzt)" : "")
                  : p
                    ? p.stage
                    : "Vorbereitung …"}
              </p>
              {slow && p?.backend === "webgpu" && (
                <p className="warning-banner">
                  Diese Kachel dauert ungewöhnlich lange. Reagiert WebGPU nicht, wird nach {fmtTime(tileTimeLimitSec(p.done, p.elapsed ?? 0))} automatisch auf der CPU neu gestartet – oder jetzt abbrechen und „CPU“ wählen.
                </p>
              )}
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
