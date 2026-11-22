import { useEffect, useState } from "react";
import { Card } from "./Card";
import { InfoText } from "./Info";
import { CT_MODELS, DEFAULT_CT_MODEL, tileTimeLimitSec } from "../segmentation/ctSegment";
import { type SegmentProgress, inferenceEstimate } from "../segmentation/infer";
import type { CtSegBackend } from "../workers/ctseg.worker";
import type { Option } from "./NormalizationPanel";

import { t } from "../i18n";
export interface CtSegCardProps {
  cts: Option[];
  defaultCtId: string | null;
  running: boolean;
  progress: SegmentProgress | null;
  status: string | null;
  error: string | null;
  webgpu: boolean;
  onRun: (ctId: string, backend: CtSegBackend, modelId: string) => void;
  onCancel: () => void;
}

const fmtTime = (sec: number) => {
  const s = Math.round(sec);
  return s < 90 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

const BACKEND_KEY = "recon-studio-ctseg-backend";
const MODEL_KEY = "recon-studio-ctseg-model";
const firefox = typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent);
/** On Macs (Apple silicon) the multi-threaded CPU is faster than WebGPU for these models (Safari and Chrome). */
const mac = typeof navigator !== "undefined" && /Macintosh|Mac OS X/i.test(navigator.userAgent);


/** Whole-body CT organ segmentation in the browser (selectable ONNX models, default TotalSegmentator "total" 3 mm). */
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
  const [modelId, setModelId] = useState<string>(() => {
    try {
      const v = localStorage.getItem(MODEL_KEY);
      return CT_MODELS.some((m) => m.id === v) ? v! : DEFAULT_CT_MODEL;
    } catch {
      return DEFAULT_CT_MODEL;
    }
  });
  const model = CT_MODELS.find((m) => m.id === modelId) ?? CT_MODELS[0];
  const chooseModel = (id: string) => {
    setModelId(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
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
  const inference = p?.inference ? inferenceEstimate(p, now) : null;
  const pct = inference ? 100 * inference.fraction : p && p.total > 0 ? (100 * p.done) / p.total : 3;
  const slow = inference && p && inference.avg && inference.since > 3 * inference.avg;
  const autoText = props.webgpu ? (firefox ? "Automatisch (Firefox: CPU)" : mac ? "Automatisch (Mac: CPU)" : "Automatisch (WebGPU)") : "Automatisch (CPU)";
  return (
    <Card title={<>{t("CT-Organsegmentierung")}</>} info={
          <>
            <p>
              {t("Organe, Knochen, Gefäße und Muskeln direkt im Browser segmentieren – die Daten verlassen den Rechner nicht. Das gewählte Modell wird beim ersten Mal geladen und im Browser gespeichert. Ergebnis: Label-Datensatz (Atlas) zum CT.")}
            </p>
            <p>
              Modelle: <b>{t("TotalSegmentator „total“ 3 mm")}</b> (Standard; 117 Strukturen inkl. Knochen, Gefäße, Muskeln),{" "}
              <b>{t("TotalSegmentator Organe 1,5 mm")}</b> {t("(24 Organe, etwas genauer, vor allem bei kleinen Organen) und")} <b>{t("MOOSE Organe 1,5 mm")}</b>{" "}
              {t("(19 Organe inkl. Gehirn und Schilddrüsenlappen; auf Low-Dose-CTs aus PET/CT trainiert, CC BY 4.0). Die 1,5-mm-Modelle brauchen etwa 3× Rechenzeit und passen nur für Rumpf-/Bauch-CTs in den Speicher. Vergleich auf Expertendaten (AMOS, 3 Fälle): mittlerer Dice 0,86 bzw. 0,85 statt 0,83.")}
            </p>
            <p>WebGPU ist auf PCs mit Grafikkarte meist deutlich schneller; auf dem Mac (Apple Silicon) ist die CPU mit allen Kernen schneller, „Automatisch“ nutzt dort die CPU. Hängt WebGPU oder meldet einen Fehler, wird automatisch auf der CPU weitergerechnet.</p>
            <p>
              Quellen: TotalSegmentator (Wasserthal et al., Radiology: AI 2023), Apache-2.0; MOOSE (Shiyam Sundar et al., J Nucl Med 2022), CC BY 4.0;
              {t("nnU-Net (Isensee et al. 2021). Nicht für diagnostische Zwecke zertifiziert.")}
            </p>
          </>
        } status={props.running ? { text: t("läuft"), tone: "run" } : null}>
      <p className="tool-hint">{t("{info}, lokal im Browser.", { info: t(model.info) })}</p>
      {props.cts.length === 0 ? (
        <p className="tool-hint">{t("Kein CT geladen.")}</p>
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
            {t("Modell")}
            <select value={model.id} disabled={props.running} onChange={(e) => chooseModel(e.target.value)}>
              {CT_MODELS.map((m) => (
                <option key={m.id} value={m.id} title={`${t(m.info)} · ${m.license} · ${m.sizeMb} MB`}>
                  {t(m.label)}
                  {m.restriction ? ` – ${m.restriction}` : ""}
                </option>
              ))}
            </select>
          </label>
          {model.restriction && <InfoText warn details={t("Lizenz {license}: {restriction}.", { license: model.license, restriction: model.restriction })}>{model.restriction}</InfoText>}
          <label className="field">
            {t("Berechnung")}
            <select value={backend} disabled={props.running} onChange={(e) => chooseBackend(e.target.value as CtSegBackend)}>
              <option value="auto">{autoText}</option>
              <option value="webgpu" disabled={!props.webgpu}>
                WebGPU (Grafikkarte){props.webgpu ? "" : t(" – nicht verfügbar")}
              </option>
              <option value="wasm">CPU</option>
            </select>
          </label>
          {!props.webgpu ? (
            <InfoText warn details={t("Kein WebGPU verfügbar: Die Berechnung läuft auf der CPU und kann für ein Ganzkörper-CT sehr lange dauern. Empfohlen: Chrome oder Edge mit aktueller Grafikkarte. Bei WebGPU-Fehlern wird automatisch auf der CPU weitergerechnet.")}>
              {t("CPU-Modus – langsam")}
            </InfoText>
          ) : firefox ? (
            <InfoText details={t("In Firefox ist WebGPU mit diesem Modell noch unzuverlässig – „Automatisch“ nutzt daher die CPU. Bei WebGPU-Fehlern wird automatisch auf der CPU weitergerechnet.")}>{t("Firefox: CPU")}</InfoText>
          ) : null}
          {!props.running ? (
            <button className="primary-btn" disabled={!ct} onClick={() => ct && props.onRun(ct.id, backend, model.id)}>
              {t("Organe segmentieren")}
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
                  ? t("{stage} · Kachel {v}/{total}", { stage: p.stage, v: Math.min(p.done + 1, p.total), total: p.total }) +
                    (p.done < p.total ? ` läuft seit ${fmtTime(inference.since)}${inference.avg ? ` (bisher Ø ${fmtTime(inference.avg)})` : ""}` : "") +
                    t(" · {v} vergangen", { v: fmtTime(inference.elapsed) }) +
                    (inference.remaining !== undefined ? t(" · noch ca. {v}", { v: fmtTime(inference.remaining) }) : p.done === 0 && p.backend === "webgpu" ? t(" · erste Kachel langsamer") : "")
                  : p
                    ? p.stage
                    : "Vorbereitung …"}
              </p>
              {slow && p?.backend === "webgpu" && (
                <InfoText
                  warn
                  details={t("Diese Kachel dauert ungewöhnlich lange. Reagiert WebGPU nicht, wird nach {v} automatisch auf der CPU neu gestartet – oder jetzt abbrechen und „CPU“ wählen.", { v: fmtTime(tileTimeLimitSec(p.done, p.elapsed ?? 0)) })}
                >
                  {t("Kachel ungewöhnlich langsam")}
                </InfoText>
              )}
              <button className="secondary-btn" onClick={props.onCancel}>
                {t("Abbrechen")}
              </button>
            </>
          )}
        </>
      )}
      {props.status && <p className="tool-hint">{props.status}</p>}
      {props.error && <div className="error-banner">{props.error}</div>}
    </Card>
  );
}
