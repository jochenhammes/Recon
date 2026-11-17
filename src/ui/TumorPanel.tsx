import { useState } from "react";
import { formatValue } from "../components/format";
import type { TumorBurden } from "../tumor/metrics";
import { EXCLUSION_PRESETS } from "../tumor/organs";
import type { Lesion, ThresholdMethod } from "../tumor/segment";
import type { Option } from "./NormalizationPanel";

export type TumorMode = "none" | "pick" | "add" | "erase";
export type TumorIndication = "lymphoma" | "psma";

type PresetId = "suv4" | "suv25" | "pct41" | "liver" | "psma3" | "custom";

const PRESETS: Record<TumorIndication, { id: PresetId; label: string }[]> = {
  lymphoma: [
    { id: "suv4", label: "SUV ≥ 4,0 (LYSA)" },
    { id: "suv25", label: "SUV ≥ 2,5" },
    { id: "pct41", label: "41 % SUVmax je Läsion" },
    { id: "liver", label: "Leber: 1,5 × Mittel + 2 SD (PERCIST)" },
    { id: "custom", label: "Eigene SUV-Schwelle" },
  ],
  psma: [
    { id: "psma3", label: "SUV ≥ 3 (PSMA-TV)" },
    { id: "liver", label: "Leber-basiert (a × Mittel + b × SD)" },
    { id: "pct41", label: "41 % SUVmax je Läsion" },
    { id: "custom", label: "Eigene SUV-Schwelle" },
  ],
};

export interface TumorPanelProps {
  targets: Option[];
  targetId: string | null;
  onTargetChange: (id: string) => void;
  /** e.g. "SUV (Körpergewicht)" or a warning when no SUV is available. */
  unitInfo: string;
  suvAvailable: boolean;
  liver: { mean: number; sd: number; ml: number } | null;
  voiAvailable: boolean;
  onLiverFromVoi: () => void;
  busy: boolean;
  error: string | null;
  onRun: (method: ThresholdMethod, minVolumeMl: number, indication: TumorIndication) => void;
  description: string | null;
  burden: TumorBurden | null;
  lesions: Lesion[];
  mode: TumorMode;
  onModeChange: (m: TumorMode) => void;
  brushMm: number;
  onBrushMmChange: (mm: number) => void;
  onToggle: (id: number) => void;
  onGoto: (id: number) => void;
  onExportCsv: () => void;
  onExportNifti: () => void;
  onClear: () => void;
  indication: TumorIndication;
  onIndicationChange: (i: TumorIndication) => void;
  /** CT organ label datasets (e.g. from the organ segmentation). */
  organOptions: Option[];
  organId: string | null;
  onOrganChange: (id: string | null) => void;
  autoExclude: boolean;
  onAutoExcludeChange: (v: boolean) => void;
  canAutoLiver: boolean;
  onAutoLiver: () => void;
  /** Bone / soft-tissue split (PSMA). */
  split: { bone: TumorBurden; soft: TumorBurden } | null;
}

const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");

export function TumorPanel(props: TumorPanelProps) {
  const { indication } = props;
  const [preset, setPreset] = useState<PresetId>("suv4");
  const [customSuv, setCustomSuv] = useState("3");
  const [liverA, setLiverA] = useState("1.5");
  const [liverB, setLiverB] = useState("2");
  const [minMl, setMinMl] = useState("0.5");
  const presets = PRESETS[indication];
  const active = presets.some((p) => p.id === preset) ? preset : presets[0].id;
  const num = (s: string) => parseFloat(s.replace(",", "."));
  const tlgLabel = indication === "psma" ? "TL-PSMA" : "TLG";

  const method = (): ThresholdMethod | null => {
    switch (active) {
      case "suv4":
        return { kind: "absolute", suv: 4 };
      case "suv25":
        return { kind: "absolute", suv: 2.5 };
      case "psma3":
        return { kind: "absolute", suv: 3 };
      case "pct41":
        return { kind: "percentMax", percent: 0.41, detectSuv: indication === "psma" ? 3 : 2.5 };
      case "custom":
        return Number.isFinite(num(customSuv)) ? { kind: "absolute", suv: num(customSuv) } : null;
      case "liver":
        return props.liver ? { kind: "liver", a: num(liverA), b: num(liverB), liverMean: props.liver.mean, liverSd: props.liver.sd } : null;
    }
  };
  const m = method();
  const b = props.burden;

  return (
    <>
      <section className="card">
        <h3>Tumorlast (metabolisches Tumorvolumen)</h3>
        <div className="segmented-control" role="group" aria-label="Indikation">
          <button className={indication === "lymphoma" ? "active" : ""} onClick={() => props.onIndicationChange("lymphoma")}>
            Lymphom (FDG)
          </button>
          <button className={indication === "psma" ? "active" : ""} onClick={() => props.onIndicationChange("psma")}>
            PSMA
          </button>
        </div>
        <label className="field">
          PET
          <select value={props.targetId ?? ""} disabled={props.busy} onChange={(e) => props.onTargetChange(e.target.value)}>
            {props.targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <p className={props.suvAvailable ? "tool-hint" : "warning-banner"}>{props.unitInfo}</p>
        <label className="field">
          Methode
          <select value={active} disabled={props.busy} onChange={(e) => setPreset(e.target.value as PresetId)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {active === "custom" && (
          <label className="field">
            SUV-Schwelle
            <input value={customSuv} onChange={(e) => setCustomSuv(e.target.value)} />
          </label>
        )}
        {active === "liver" && (
          <>
            <div className="inline-fields">
              <label className="field">
                a (× Mittel)
                <input value={liverA} onChange={(e) => setLiverA(e.target.value)} />
              </label>
              <label className="field">
                b (× SD)
                <input value={liverB} onChange={(e) => setLiverB(e.target.value)} />
              </label>
              <span />
            </div>
            <p className="tool-hint">
              {props.liver
                ? `Leber-Referenz: SUV ${f(props.liver.mean)} ± ${f(props.liver.sd)} (${f(props.liver.ml, 1)} ml) → Schwelle SUV ${f(num(liverA) * props.liver.mean + num(liverB) * props.liver.sd)}`
                : "Leber-Referenz fehlt: im Tab „Bearbeiten“ eine 3-cm-Kugel-VOI (Radius 15 mm) im rechten Leberlappen setzen und übernehmen."}
            </p>
            <div className="button-row">
              <button className="secondary-btn" disabled={!props.canAutoLiver} onClick={props.onAutoLiver} title="3-cm-Kugel im rechten Leberlappen aus der CT-Lebermaske">
                Leber-VOI automatisch
              </button>
              <button className="secondary-btn" disabled={!props.voiAvailable} onClick={props.onLiverFromVoi}>
                Aktuelle VOI übernehmen
              </button>
            </div>
          </>
        )}
        <label className="field">
          Organmasken (CT)
          <select value={props.organId ?? ""} disabled={props.busy} onChange={(e) => props.onOrganChange(e.target.value || null)}>
            <option value="">keine</option>
            {props.organOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {props.organId && (
          <>
            <label className="checkbox-field">
              <input type="checkbox" checked={props.autoExclude} onChange={(e) => props.onAutoExcludeChange(e.target.checked)} />
              Physiologische Anreicherung ausschließen: {EXCLUSION_PRESETS[indication].map((n) => n.replace(/_/g, " ")).join(", ")}
            </label>
            {indication === "psma" && <p className="tool-hint">Speichel- und Tränendrüsen sind im CT-Modell nicht enthalten – Kopf-Anreicherungen bitte per Klick ausschließen.</p>}
          </>
        )}
        {props.organOptions.length === 0 && <p className="tool-hint">Ohne Organmasken: oben „Organe segmentieren“ (CT nötig) – dann werden Niere, Blase usw. automatisch ausgeschlossen.</p>}
        <label className="field">
          Mindestvolumen je Läsion (ml)
          <input value={minMl} onChange={(e) => setMinMl(e.target.value)} />
        </label>
        <button className="primary-btn" disabled={props.busy || !m || !props.targetId} onClick={() => m && props.onRun(m, Math.max(0, num(minMl) || 0), indication)}>
          {props.busy ? "Wird segmentiert …" : "Läsionen segmentieren"}
        </button>
        {props.error && <div className="error-banner">{props.error}</div>}
      </section>

      {b && (
        <section className="card">
          <h3>Ergebnis</h3>
          <p className="tool-hint">{props.description}</p>
          <dl className="summary-list">
            <dt>Läsionen</dt>
            <dd>{b.lesions}</dd>
            <dt>{indication === "psma" ? "PSMA-TV" : "TMTV"}</dt>
            <dd>{f(b.tmtv, 1)} ml</dd>
            <dt>{tlgLabel}</dt>
            <dd>{f(b.tlg, 1)} ml·SUV</dd>
            <dt>SUVmax</dt>
            <dd>{f(b.suvMax)}</dd>
            <dt>SUVmean</dt>
            <dd>{f(b.suvMean)}</dd>
            {indication === "psma" && props.split && (
              <>
                <dt>davon Knochen</dt>
                <dd>
                  {props.split.bone.lesions} · {f(props.split.bone.tmtv, 1)} ml
                </dd>
                <dt>davon Weichteil</dt>
                <dd>
                  {props.split.soft.lesions} · {f(props.split.soft.tmtv, 1)} ml
                </dd>
              </>
            )}
            {indication === "lymphoma" && (
              <>
                <dt>Dmax</dt>
                <dd>{f(b.dmax / 10, 1)} cm</dd>
                <dt>Dmax_bulk</dt>
                <dd>{f(b.dmaxBulk / 10, 1)} cm</dd>
              </>
            )}
          </dl>
          <div className="segmented-control" role="group" aria-label="Korrektur">
            {(
              [
                ["none", "Ansehen"],
                ["pick", "Klick: ein/aus"],
                ["add", "Pinsel +"],
                ["erase", "Pinsel −"],
              ] as [TumorMode, string][]
            ).map(([k, label]) => (
              <button key={k} className={props.mode === k ? "active" : ""} onClick={() => props.onModeChange(k)}>
                {label}
              </button>
            ))}
          </div>
          {(props.mode === "add" || props.mode === "erase") && (
            <label className="field">
              Pinselradius {props.brushMm} mm
              <input type="range" min={2} max={30} value={props.brushMm} onChange={(e) => props.onBrushMmChange(Number(e.target.value))} />
            </label>
          )}
          <p className="tool-hint">
            {props.mode === "pick"
              ? "Klick auf eine Läsion im Bild schließt sie ein oder aus (z. B. physiologische Anreicherung)."
              : props.mode === "add"
                ? "Ziehen ergänzt Läsionsvoxel (in die angeklickte Läsion bzw. als neue Läsion)."
                : props.mode === "erase"
                  ? "Ziehen entfernt Voxel aus den Läsionen."
                  : "Ausgeschlossene Läsionen werden nicht angezeigt und nicht gezählt."}
          </p>
          <div className="button-row">
            <button className="secondary-btn" onClick={props.onExportCsv}>
              CSV
            </button>
            <button className="secondary-btn" onClick={props.onExportNifti}>
              Maske (NIfTI)
            </button>
            <button className="secondary-btn" onClick={props.onClear}>
              Verwerfen
            </button>
          </div>
          <div className="region-table-wrap">
            <table className="region-table">
              <thead>
                <tr>
                  <th />
                  <th>Nr</th>
                  <th>ml</th>
                  <th>SUVmax</th>
                  <th>SUVpeak</th>
                  <th>{tlgLabel}</th>
                  {props.organId && <th>Ort</th>}
                </tr>
              </thead>
              <tbody>
                {[...props.lesions]
                  .sort((x, y) => y.suvMax - x.suvMax)
                  .map((l) => (
                    <tr key={l.id} className={l.included ? "clickable" : "clickable excluded-row"} onClick={() => props.onGoto(l.id)} title={l.note ?? "Zur Läsion springen"}>
                      <td>
                        <input type="checkbox" checked={l.included} onClick={(e) => e.stopPropagation()} onChange={() => props.onToggle(l.id)} />
                      </td>
                      <td>{l.id}</td>
                      <td>{formatValue(l.volumeMl)}</td>
                      <td>{f(l.suvMax)}</td>
                      <td>{f(l.suvPeak)}</td>
                      <td>{f(l.tlg, 1)}</td>
                      {props.organId && <td className="organ-cell">{l.bone ? "Knochen" : (l.organ ?? "")}</td>}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
