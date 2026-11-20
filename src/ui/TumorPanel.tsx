import { useEffect, useRef, useState } from "react";
import { BigTable } from "./BigTable";
import { Card } from "./Card";
import { InfoText } from "./Info";
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
  /** Lesion being reviewed (cursor there). */
  focusId: number | null;
  /** Confirm (true) or reject (false) a lesion; the app moves on to the next unreviewed one. */
  onReview: (id: number, include: boolean) => void;
  /** Removes excluded lesions for good and renumbers the rest. */
  onCleanup: () => void;
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
      <Card title={<>Tumorlast (metabolisches Tumorvolumen)</>}>
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
        <InfoText warn={!props.suvAvailable} details={props.unitInfo}>
          {props.suvAvailable ? "Schwellen in SUV" : "Kein SUV – Werte als SUV gewertet"}
        </InfoText>
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
            {props.liver ? (
              <p className="tool-hint">
                Leber SUV {f(props.liver.mean)} ± {f(props.liver.sd)} ({f(props.liver.ml, 1)} ml) → Schwelle SUV {f(num(liverA) * props.liver.mean + num(liverB) * props.liver.sd)}
              </p>
            ) : (
              <InfoText warn details="Leber-Referenz (PERCIST): 3-cm-Kugel-VOI (Radius 15 mm) im rechten Leberlappen – automatisch aus der CT-Lebermaske oder im Bereich „Bearbeiten“ setzen und hier übernehmen.">
                Leber-Referenz fehlt
              </InfoText>
            )}
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
            {indication === "psma" && (
              <InfoText details="Speichel- und Tränendrüsen sind im CT-Modell nicht enthalten – Kopf-Anreicherungen bitte per Klick ausschließen.">Drüsen von Hand ausschließen</InfoText>
            )}
          </>
        )}
        {props.organOptions.length === 0 && (
          <InfoText details="Ohne Organmasken: oben „Organe segmentieren“ (CT nötig) – dann werden Niere, Blase usw. automatisch als physiologische Anreicherung ausgeschlossen.">Keine Organmasken</InfoText>
        )}
        <label className="field">
          Mindestvolumen je Läsion (ml)
          <input value={minMl} onChange={(e) => setMinMl(e.target.value)} />
        </label>
        <button className="primary-btn" disabled={props.busy || !m || !props.targetId} onClick={() => m && props.onRun(m, Math.max(0, num(minMl) || 0), indication)}>
          {props.busy ? "Wird segmentiert …" : "Läsionen segmentieren"}
        </button>
        {props.error && <div className="error-banner">{props.error}</div>}
      </Card>

      {b && (
        <Card title={<>Ergebnis</>}>
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
          <ReviewBox lesions={props.lesions} focusId={props.focusId} onGoto={props.onGoto} onReview={props.onReview} onCleanup={props.onCleanup} />
          <div className="button-row">
            <button className="secondary-btn" onClick={props.onExportCsv}>
              CSV
            </button>
            <button className="secondary-btn" onClick={props.onExportNifti}>
              Maske (NIfTI)
            </button>
            <button className="secondary-btn" title="Das ganze Tumorlast-Ergebnis (und den Läsionen-Datensatz) löschen" onClick={props.onClear}>
              Ergebnis löschen
            </button>
          </div>
          <BigTable title="Tumorlast – Läsionen" onCsv={props.onExportCsv}>
            <table className="region-table">
              <thead>
                <tr>
                  <th />
                  <th title="Prüfstatus: ✓ bestätigt, ✗ verworfen, · offen">Geprüft</th>
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
                    <tr
                      key={l.id}
                      className={`clickable${l.included ? "" : " excluded-row"}${l.id === props.focusId ? " focus-row" : ""}`}
                      onClick={() => props.onGoto(l.id)}
                      title={l.note ?? "Zur Läsion springen"}
                    >
                      <td>
                        <input type="checkbox" checked={l.included} onClick={(e) => e.stopPropagation()} onChange={() => props.onToggle(l.id)} />
                      </td>
                      <td className="review-cell">{l.reviewed ? (l.included ? "✓" : "✗") : "·"}</td>
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
          </BigTable>
        </Card>
      )}
    </>
  );
}

/**
 * Guided review: step through the lesions (SUVmax descending), confirm or reject each one; keyboard: Enter = confirm,
 * Entf/Backspace = reject, ←/→ = previous/next (while the tumor panel is shown and no input field has the focus).
 */
function ReviewBox({
  lesions,
  focusId,
  onGoto,
  onReview,
  onCleanup,
}: {
  lesions: Lesion[];
  focusId: number | null;
  onGoto: (id: number) => void;
  onReview: (id: number, include: boolean) => void;
  onCleanup: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sorted = [...lesions].sort((a, b) => b.suvMax - a.suvMax);
  const idx = sorted.findIndex((l) => l.id === focusId);
  const cur = idx >= 0 ? sorted[idx] : null;
  const reviewed = lesions.filter((l) => l.reviewed).length;
  const excluded = lesions.filter((l) => !l.included).length;
  const step = (d: number) => {
    if (!sorted.length) return;
    const i = idx < 0 ? 0 : (idx + d + sorted.length) % sorted.length;
    onGoto(sorted[i].id);
  };
  const firstOpen = () => onGoto((sorted.find((l) => !l.reviewed) ?? sorted[0]).id);

  const latest = useRef({ cur, step, onReview });
  latest.current = { cur, step, onReview };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only while this panel is visible, no modifier, and not typing in a field.
      if (!ref.current?.offsetParent || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, select, textarea, [contenteditable=true]")) return;
      // Enter on a focused button already clicks it (e.g. "Bestätigen" again for the next lesion).
      if (e.key === "Enter" && t.closest("button")) return;
      const { cur, step, onReview } = latest.current;
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "Enter" && cur) onReview(cur.id, true);
      else if ((e.key === "Delete" || e.key === "Backspace") && cur) onReview(cur.id, false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!lesions.length) return null;
  return (
    <div className="review-box" ref={ref}>
      <div className="review-head">
        <strong>Durchsehen</strong>
        <span>
          {reviewed}/{lesions.length} geprüft
        </span>
      </div>
      <div className="review-progress" aria-hidden="true">
        <span style={{ width: `${(100 * reviewed) / lesions.length}%` }} />
      </div>
      {cur ? (
        <p className="tool-hint">
          Läsion {cur.id} ({idx + 1}/{sorted.length}) · {formatValue(cur.volumeMl)} ml · SUVmax {formatValue(cur.suvMax)}
          {cur.bone ? " · Knochen" : cur.organ ? ` · ${cur.organ.replace(/_/g, " ")}` : ""} ·{" "}
          {cur.reviewed ? (cur.included ? "bestätigt" : "verworfen") : cur.included ? "offen" : "offen (ausgeschlossen)"}
        </p>
      ) : (
        <InfoText details="Jede Läsion ansehen und bestätigen oder verwerfen – die Ansicht springt jeweils zur nächsten offenen.">Läsionen prüfen</InfoText>
      )}
      {cur ? (
        <div className="review-buttons">
          <button className="secondary-btn" onMouseDown={(e) => e.preventDefault()} title="Vorherige (←)" onClick={() => step(-1)}>
            ◀
          </button>
          <button className="secondary-btn confirm" onMouseDown={(e) => e.preventDefault()} title="Bestätigen (Enter)" onClick={() => onReview(cur.id, true)}>
            ✓ Bestätigen
          </button>
          <button className="secondary-btn reject" onMouseDown={(e) => e.preventDefault()} title="Verwerfen (Entf)" onClick={() => onReview(cur.id, false)}>
            ✗ Verwerfen
          </button>
          <button className="secondary-btn" onMouseDown={(e) => e.preventDefault()} title="Nächste (→)" onClick={() => step(1)}>
            ▶
          </button>
        </div>
      ) : (
        <button className="secondary-btn" onMouseDown={(e) => e.preventDefault()} onClick={firstOpen}>
          Durchsehen starten
        </button>
      )}
      {cur && <p className="tool-hint review-keys">Tastatur: Enter = bestätigen · Entf = verwerfen · ←/→ = blättern</p>}
      <button className="secondary-btn" disabled={!excluded} title="Ausgeschlossene Läsionen endgültig entfernen, übrige nach SUVmax neu nummerieren" onClick={onCleanup}>
        Bereinigen{excluded ? ` (${excluded} ausgeschlossene entfernen)` : ""}
      </button>
    </div>
  );
}
