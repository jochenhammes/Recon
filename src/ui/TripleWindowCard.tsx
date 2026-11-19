import { useState } from "react";
import { formatInput, parseInput } from "../components/format";
import { type HuWindow, TRIPLE_DEFAULTS } from "../edit/tripleWindow";
import { Card } from "./Card";
import type { Option } from "./NormalizationPanel";

export interface TripleWindowRequest {
  ctId: string;
  organId: string;
  windows: { soft: HuWindow; lung: HuWindow; bone: HuWindow };
  marginMm: { lung: number; bone: number };
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
  const [lungMm, setLungMm] = useState("4");
  const [boneMm, setBoneMm] = useState("2");
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
      title={<>Triple-Window-CT</>}
      defaultOpen={false}
      persistKey="triple-window"
      info={
        <>
          <p>
            Künstlicher CT-Datensatz für den schnellen anatomischen Überblick in <strong>einem</strong> Fenster: Alle Voxel stehen im Weichteilfenster; Voxel
            der Lungen (inkl. Trachea) werden so umgerechnet, dass sie wie im Lungenfenster erscheinen, Voxel des Skeletts wie im Knochenfenster.
          </p>
          <p>
            Grundlage ist die Organkarte der CT-Segmentierung (Bereich Tumorlast). An den Grenzen zwischen den Fenstern liegt ein schwarzer Rand
            (Lunge: beidseits der Pleuragrenze, Knochen: außen um die Kortikalis); er verdeckt den sonst hellen Übergangssaum aus Brustwand bzw.
            Teilvolumen der gröberen Organkarte. 0 mm = ohne Rand. Die Werte sind keine echten HU mehr – nicht für Messungen oder Diagnostik verwenden.
          </p>
        </>
      }
    >
      {props.cts.length === 0 || props.organSets.length === 0 ? (
        <p className="tool-hint">Benötigt ein CT und seine Organkarte (Tumorlast → CT-Organsegmentierung).</p>
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
            Organkarte
            <select value={organs?.id ?? ""} disabled={props.busy} onChange={(e) => setOrganId(e.target.value)}>
              {props.organSets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="triple-row triple-head">
            <span>Fenster (HU)</span>
            <span>Zentrum</span>
            <span>Breite</span>
          </div>
          {row("soft", "Weichteil (Basis)")}
          {row("lung", "Lunge")}
          {row("bone", "Knochen")}
          <div className="imcalc-coeffs">
            <label className="field">
              Schwarzer Rand Lunge (mm)
              <input value={lungMm} disabled={props.busy} onChange={(e) => setLungMm(e.target.value)} />
            </label>
            <label className="field">
              Schwarzer Rand Knochen (mm)
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
              })
            }
          >
            {props.busy ? "Wird erzeugt …" : "Triple-Window-CT erzeugen"}
          </button>
        </>
      )}
      {props.status && <p className="tool-hint">{props.status}</p>}
      {props.error && <div className="error-banner">{props.error}</div>}
    </Card>
  );
}
