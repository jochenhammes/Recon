import { useState } from "react";
import { formatInput, parseInput } from "../components/format";
import { type HuWindow, TRIPLE_DEFAULTS } from "../edit/tripleWindow";
import { Card } from "./Card";
import type { Option } from "./NormalizationPanel";

import { t } from "../i18n";
import { T } from "../i18n/T";
export interface TripleWindowRequest {
  ctId: string;
  organId: string;
  windows: { soft: HuWindow; lung: HuWindow; bone: HuWindow };
  /** Black rims (mm, 0 = none). */
  marginMm: { lung: number; bone: number };
  /** Smoothing of the organ masks (FWHM, mm). */
  smoothMm: number;
}

const toCw = (w: HuWindow) => [(w[0] + w[1]) / 2, w[1] - w[0]];

/** "Bearbeiten": artificial triple-window CT from a CT and its organ map (lungs and skeleton in their own windows). */
export function TripleWindowCard(props: {
  cts: Option[];
  organSets: (Option & { forCt?: string })[];
  busy: boolean;
  status: string | null;
  error: string | null;
  onRun: (r: TripleWindowRequest) => void;
}) {
  const [ctId, setCtId] = useState("");
  const [organId, setOrganId] = useState("");
  const [cw, setCw] = useState<Record<"soft" | "lung" | "bone", [string, string]>>(() => {
    const f = (w: HuWindow) => toCw(w).map((v) => formatInput(v)) as [string, string];
    return { soft: f(TRIPLE_DEFAULTS.soft), lung: f(TRIPLE_DEFAULTS.lung), bone: f(TRIPLE_DEFAULTS.bone) };
  });
  const [lungMm, setLungMm] = useState("0");
  const [boneMm, setBoneMm] = useState("0");
  const [smoothMm, setSmoothMm] = useState("6");
  const ct = props.cts.find((c) => c.id === ctId) ?? props.cts[0];
  const organs = props.organSets.find((o) => o.id === organId) ?? props.organSets.find((o) => o.forCt === ct?.id) ?? props.organSets[0];
  const win = (k: "soft" | "lung" | "bone"): HuWindow | null => {
    const c = parseInput(cw[k][0]), w = parseInput(cw[k][1]);
    return Number.isFinite(c) && w > 0 ? [c - w / 2, c + w / 2] : null;
  };
  const windows = { soft: win("soft"), lung: win("lung"), bone: win("bone") };
  const ok = !!ct && !!organs && windows.soft && windows.lung && windows.bone;
  const row = (k: "soft" | "lung" | "bone", label: string) => (
    <div className="triple-row" key={k}>
      <span>{label}</span>
      {[0, 1].map((i) => (
        <input
          key={i}
          value={cw[k][i]}
          aria-label={`${label} ${i ? "Breite" : "Zentrum"}`}
          disabled={props.busy}
          onChange={(e) => setCw((p) => ({ ...p, [k]: (i ? [p[k][0], e.target.value] : [e.target.value, p[k][1]]) as [string, string] }))}
        />
      ))}
    </div>
  );
  return (
    <Card
      title={<>{t("Triple-Window-CT")}</>}
      defaultOpen={false}
      persistKey="triple-window"
      info={
        <>
          <p>
            <T k="Künstlicher CT-Datensatz für den schnellen anatomischen Überblick in {b}einem{/b} Fenster: Alle Voxel stehen im Weichteilfenster; Voxel der Lungen (inkl. Trachea) werden so umgerechnet, dass sie wie im Lungenfenster erscheinen, Voxel des Skeletts wie im Knochenfenster." b={(c) => <strong>{c}</strong>} />
          </p>
          <p>
            {t("Grundlage ist die Organkarte der CT-Segmentierung (Bereich Segmentierung & MTV, 3-mm-Raster). Damit an den Grenzen keine Treppen entstehen, werden Lungen- und Skelettmaske weichgezeichnet (Kantenglättung) und für jedes CT-Voxel interpoliert; die Fenster gehen über ±0,75 mm weich ineinander über. Optional markiert ein schwarzer Rand die Grenze (Lunge: beidseits, Knochen: außen; 0 mm = ohne). Die Werte sind keine echten HU mehr – nicht für Messungen oder Diagnostik verwenden.")}
          </p>
        </>
      }
    >
      {props.cts.length === 0 || props.organSets.length === 0 ? (
        <p className="tool-hint" title={t("Organkarte: Bereich „Segmentierung & MTV“ → CT-Organsegmentierung")}>{t("Benötigt CT + Organkarte")}</p>
      ) : (
        <>
          <label className="field">
            CT
            <select value={ct?.id ?? ""} disabled={props.busy} onChange={(e) => setCtId(e.target.value)}>
              {props.cts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t("Organkarte")}
            <select value={organs?.id ?? ""} disabled={props.busy} onChange={(e) => setOrganId(e.target.value)}>
              {props.organSets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="triple-row triple-head">
            <span>{t("Fenster (HU)")}</span>
            <span>{t("Zentrum")}</span>
            <span>{t("Breite")}</span>
          </div>
          {row("soft", "Weichteil (Basis)")}
          {row("lung", t("Lunge"))}
          {row("bone", t("Knochen"))}
          <label className="field">
            {t("Kantenglättung (mm, FWHM)")}
            <input value={smoothMm} disabled={props.busy} onChange={(e) => setSmoothMm(e.target.value)} />
          </label>
          <div className="imcalc-coeffs">
            <label className="field">
              {t("Schwarzer Rand Lunge (mm)")}
              <input value={lungMm} disabled={props.busy} onChange={(e) => setLungMm(e.target.value)} />
            </label>
            <label className="field">
              {t("Schwarzer Rand Knochen (mm)")}
              <input value={boneMm} disabled={props.busy} onChange={(e) => setBoneMm(e.target.value)} />
            </label>
          </div>
          <button
            className="primary-btn"
            disabled={props.busy || !ok}
            onClick={() =>
              ok &&
              props.onRun({
                ctId: ct!.id,
                organId: organs!.id,
                windows: { soft: windows.soft!, lung: windows.lung!, bone: windows.bone! },
                marginMm: { lung: Math.max(0, parseInput(lungMm) || 0), bone: Math.max(0, parseInput(boneMm) || 0) },
                smoothMm: Math.max(0.5, parseInput(smoothMm) || 6),
              })
            }
          >
            {props.busy ? t("Wird erzeugt …") : "Triple-Window-CT erzeugen"}
          </button>
        </>
      )}
      {props.status && <p className="tool-hint">{props.status}</p>}
      {props.error && <div className="error-banner">{props.error}</div>}
    </Card>
  );
}
