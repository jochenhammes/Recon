import { useState } from "react";
import { formatValue } from "../components/format";
import type { LoadedDataset } from "../dataset/types";
import { InfoText } from "../ui/Info";
import { calibrationFromPhantom, timePointFromHeader } from "./calibration";

import { t } from "../i18n";
export interface PhantomCandidate {
  id: string;
  label: string;
  dataset: LoadedDataset;
}

function numOrUndef(s: string): number | undefined {
  const v = Number(s.replace(",", ".").trim());
  return s.trim() === "" || !Number.isFinite(v) ? undefined : v;
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Calibration factor from a phantom SPECT with known activity: total counts in the field of view, acquisition
 * time and duration from the header, activity decayed to the acquisition start, decay during the acquisition corrected.
 */
export function PhantomCalibration({
  candidates,
  halfLifeSec,
  nuclide,
  onUse,
}: {
  candidates: PhantomCandidate[];
  halfLifeSec?: number;
  nuclide: string;
  /** Takes the factor into a camera profile (new or current). */
  onUse: (cpsPerMBq: number, note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [activity, setActivity] = useState("");
  const [timeMs, setTimeMs] = useState<number | undefined>(undefined);
  const [duration, setDuration] = useState("");
  const e = candidates.find((c) => c.id === id);
  const ds = e?.dataset.source.kind === "dicom" ? e.dataset.source.files[0].dataSet : undefined;
  const h = ds ? timePointFromHeader(ds) : undefined;
  const actMBq = numOrUndef(activity) ?? h?.injectedMBq;
  const actTime = timeMs ?? h?.injectionMs;
  const durationSec = numOrUndef(duration) ?? h?.durationSec;
  let counts = 0;
  if (e) for (const v of e.dataset.current.data) if (v > 0) counts += v;
  const quantitative = h?.units?.toUpperCase() === "BQML";
  const decayCorrected = !!h?.decayCorrection && h.decayCorrection.toUpperCase() !== "NONE";
  const missing = [!e && "Phantom-SPECT", !actMBq && t("Aktivität"), !actTime && t("Zeitpunkt der Aktivität"), !h?.acquisitionMs && t("Aufnahmezeit (Header)"), !durationSec && t("Aufnahmedauer"), !halfLifeSec && t("Nuklid")].filter(Boolean);
  const cf =
    !missing.length && e && halfLifeSec
      ? calibrationFromPhantom({ counts, durationSec: durationSec!, activityMBq: actMBq!, activityTimeMs: actTime!, acquisitionMs: h!.acquisitionMs!, halfLifeSec, decayCorrected })
      : NaN;
  const hours = actTime !== undefined && h?.acquisitionMs !== undefined ? (h.acquisitionMs - actTime) / 3.6e6 : undefined;

  if (!open)
    return (
      <button className="link-btn" onClick={() => setOpen(true)}>
        {t("Kalibrierfaktor aus Phantomaufnahme bestimmen …")}
      </button>
    );
  return (
    <div className="dos-profile">
      <strong>{t("Kalibrierfaktor aus Phantom")}</strong>
      <InfoText details={t("Phantom (z. B. Zylinder mit bekannter Aktivität) mit derselben Kamera, demselben Kollimator, Energiefenster und derselben Rekonstruktion wie die Patientenaufnahmen messen. Das ganze Phantom muss im Sichtfeld liegen: gezählt wird die Summe aller positiven Voxel. Aktivität und Zeitpunkt der Messung (Aktivimeter) eingeben; Aufnahmezeit und -dauer kommen aus dem Header.")}>
        {t("Ganzes Phantom im Sichtfeld")}
      </InfoText>
      <label className="field">
        {t("Phantom-SPECT")}
        <select value={id} onChange={(ev) => setId(ev.target.value)}>
          <option value="">{t("– wählen –")}</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <div className="field-row">
        <label className="field">
          Aktivität (MBq)
          <input type="text" inputMode="decimal" placeholder={h?.injectedMBq !== undefined ? t("{v} (Header)", { v: formatValue(h.injectedMBq) }) : ""} value={activity} onChange={(ev) => setActivity(ev.target.value)} />
        </label>
        <label className="field">
          {t("gemessen am")}
          <input type="datetime-local" value={actTime !== undefined ? toLocalInput(actTime) : ""} onChange={(ev) => setTimeMs(ev.target.value ? new Date(ev.target.value).getTime() : undefined)} />
        </label>
      </div>
      <label className="field">
        Aufnahmedauer (s)
        <input type="text" inputMode="decimal" placeholder={h?.durationSec !== undefined ? t("{v} (Header)", { v: Math.round(h.durationSec) }) : "fehlt"} value={duration} onChange={(ev) => setDuration(ev.target.value)} />
      </label>
      {quantitative && <p className="tool-hint tool-warning">{t("Das Bild ist bereits in Bq/ml – ein Kalibrierfaktor ist dafür nicht nötig.")}</p>}
      {e && (
        <p className="tool-hint">
          Summe {formatValue(Number(counts.toPrecision(4)))} Counts
          {hours !== undefined ? t(" · Aufnahme {v} h nach der Aktivitätsmessung", { v: hours.toFixed(2).replace(".", ",") }) : ""}
          {decayCorrected ? ` · ${t("Bild zerfallskorrigiert")}` : ""}
        </p>
      )}
      {missing.length > 0 ? (
        <p className="tool-hint">Fehlt: {missing.join(", ")}.</p>
      ) : (
        <p>
          <b>{formatValue(Number(cf.toPrecision(4)))} cps/MBq</b> ({nuclide})
        </p>
      )}
      <div className="button-row">
        <button
          className="primary-btn"
          disabled={!Number.isFinite(cf)}
          onClick={() => onUse(Number(cf.toPrecision(5)), t("Phantom {v}: {v2} MBq, {v3}", { v: e?.label ?? "", v2: formatValue(actMBq!), v3: new Date(actTime!).toLocaleString("de-DE") }))}
        >
          {t("In Kamera-Profil übernehmen")}
        </button>
        <button className="secondary-btn" onClick={() => setOpen(false)}>
          {t("Schließen")}
        </button>
      </div>
    </div>
  );
}
