import { useState } from "react";
import { formatValue } from "../components/format";
import { CT_MODELS, DEFAULT_CT_MODEL } from "../segmentation/ctSegment";
import { Card } from "../ui/Card";
import { InfoText } from "../ui/Info";
import { type AxisPoint, TimeAxis } from "./TimeAxis";
import { fmtDateTime } from "./sessions";

/** A selectable dataset of one role. */
export interface TpOption {
  id: string;
  label: string;
  acqMs?: number;
}

/** Everything the card shows about one time point (computed by the panel). */
export interface TpCardView {
  spectId: string;
  label: string;
  ctId?: string;
  organSetId?: string;
  lesionSetId?: string;
  acqMs?: number;
  tH?: number;
  /** Values entered by hand (shown in the fields; placeholders show the header values). */
  tHoursManual?: number;
  durationSecManual?: number;
  durationSec?: number;
  decayCorrected: boolean;
  /** "Counts" (needs camera profile) or "Bq/ml" (quantitative). */
  unit: "Counts" | "Bq/ml";
  /** Where the unit comes from (header, camera profile or chosen by hand). */
  unitSource: "Header" | "Profil" | "manuell";
  calibrated: boolean;
  registered: boolean;
  fovMBq?: number;
  pctInjected?: number;
  /** Header remarks and plausibility warnings. */
  notes: string[];
  warnings: string[];
}

export interface UnassignedItem {
  id: string;
  label: string;
  role: "functional" | "ct" | "label";
}

export interface TimePointsCardProps {
  views: TpCardView[];
  /** Sessions with a functional image not used as time point (can be added). */
  spare: { key: string; label: string; acqMs?: number; h?: number }[];
  unassigned: UnassignedItem[];
  options: { functional: TpOption[]; cts: TpOption[]; organs: TpOption[]; lesions: TpOption[] };
  injection: { ms?: number; mbq?: number; fromHeader: boolean };
  onInjection: (patch: { timeMs?: number | null; activityMBq?: number | null }) => void;
  /** The automatic grouping differs from the current time points. */
  suggestionDiffers: boolean;
  onApplySuggestion: () => void;
  onUpdate: (spectId: string, patch: Partial<{ spectId: string; ctId: string; organSetId: string; lesionSetId: string; tHoursManual: number; durationSecManual: number; decayCorrected: boolean; unitOverride: "Counts" | "Bq/ml" | undefined }>) => void;
  onAddSession: (key: string) => void;
  onAddFunctional: (id: string) => void;
  onAssign: (itemId: string, role: UnassignedItem["role"], spectId: string) => void;
  onRemove: (spectId: string) => void;
  onShow: (spectId: string) => void;
  onSegment: (ctId: string, modelId: string) => void;
  segRunning: boolean;
  onRegister: () => void;
  busy: boolean;
}

const fmt = (v: number | undefined, digits = 3) => (v === undefined || !Number.isFinite(v) ? "–" : formatValue(Number(v.toPrecision(digits))));
const fmtH = (h: number | undefined) => (h === undefined ? "– h" : `${h.toFixed(1).replace(".", ",")} h`);

function numOrUndef(s: string): number | undefined {
  const v = Number(s.replace(",", ".").trim());
  return s.trim() === "" || !Number.isFinite(v) ? undefined : v;
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Options of a role: those close in time to the time point first. */
function RoleSelect({ value, options, near, empty, onChange }: { value?: string; options: TpOption[]; near?: number; empty: string; onChange: (id: string) => void }) {
  const dist = (o: TpOption) => (near !== undefined && o.acqMs !== undefined ? Math.abs(o.acqMs - near) : Infinity);
  const sorted = [...options].sort((a, b) => dist(a) - dist(b));
  return (
    <select className="inline-select" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {sorted.map((o) => (
        <option key={o.id} value={o.id} title={`${o.label}${o.acqMs !== undefined ? ` · ${fmtDateTime(o.acqMs)}` : ""}`}>
          {o.label}
          {o.acqMs !== undefined && o.acqMs !== near ? ` · ${fmtDateTime(o.acqMs)}` : ""}
        </option>
      ))}
    </select>
  );
}

function Chip({ ok, children, title }: { ok: boolean | "na"; children: React.ReactNode; title?: string }) {
  return (
    <span className={`dos-chip ${ok === "na" ? "na" : ok ? "ok" : "missing"}`} title={title}>
      {ok === true ? "✓ " : ok === false ? "○ " : ""}
      {children}
    </span>
  );
}

/**
 * Measurement time points of the dosimetry: time axis (hours p.i.) and one compact card per time point with its
 * functional image (SPECT/PET), CT, organ map and lesion map, status and plausibility hints.
 */
export function TimePointsCard(p: TimePointsCardProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [model, setModel] = useState(DEFAULT_CT_MODEL);
  const relative = p.injection.ms === undefined;
  const first = [...p.views.map((v) => v.acqMs), ...p.spare.map((s) => s.acqMs)].filter((t): t is number => t !== undefined).sort((a, b) => a - b)[0];
  const axisH = (tH: number | undefined, acqMs: number | undefined) => tH ?? (acqMs !== undefined && first !== undefined ? (acqMs - first) / 3.6e6 : undefined);
  const points: AxisPoint[] = [
    ...p.views.flatMap((v, n): AxisPoint[] => {
      const h = axisH(v.tH, v.acqMs);
      if (h === undefined) return [];
      const complete = v.tH !== undefined && v.calibrated && !!v.ctId && !!v.organSetId;
      return [{ key: v.spectId, h, label: `T${n + 1}`, title: `${v.label}\n${fmtDateTime(v.acqMs)}`, state: complete ? "ok" : "incomplete", selected: open === v.spectId }];
    }),
    ...p.spare.flatMap((s): AxisPoint[] => {
      const h = s.h ?? axisH(undefined, s.acqMs);
      return h === undefined ? [] : [{ key: s.key, h, label: "–", title: `${s.label} (nicht verwendet)\n${fmtDateTime(s.acqMs)}`, state: "unused" }];
    }),
  ];
  const usable = p.views.filter((v) => v.ctId).length;

  return (
    <Card
      title={<>Zeitpunkte</>}
      persistKey="dos-tp"
      status={p.views.length ? { text: `${p.views.length}`, tone: p.views.every((v) => !v.warnings.length) ? "info" : "warn" } : null}
      info={
        <>
          <p>
            Je Messzeitpunkt ein Funktionsbild (SPECT in Counts oder quantitativ in Bq/ml, auch PET) mit dem CT derselben Aufnahme, der Organkarte
            (CT-Segmentierung) und optional einem Läsionsbild. Die Datensätze werden automatisch nach FrameOfReference, Studie und Aufnahmezeit
            (DICOM-Header) zu Aufnahmen gruppiert; jede Rolle lässt sich per Auswahl ändern.
          </p>
          <p>
            Zeit p.i. = Aufnahmezeit − Injektion (beides aus dem Header, überschreibbar). Die Zeitachse zeigt alle Aufnahmen; grau = nicht als
            Zeitpunkt verwendet (Klick: hinzufügen).
          </p>
        </>
      }
    >
      <div className="field-row">
        <label className="field">
          Injektion{p.injection.fromHeader ? " (Header)" : ""}
          <input type="datetime-local" value={p.injection.ms ? toLocalInput(p.injection.ms) : ""} onChange={(e) => p.onInjection({ timeMs: e.target.value ? new Date(e.target.value).getTime() : null })} />
        </label>
        <label className="field">
          Aktivität (MBq)
          <input type="text" inputMode="decimal" value={p.injection.mbq ?? ""} onChange={(e) => p.onInjection({ activityMBq: numOrUndef(e.target.value) ?? null })} />
        </label>
      </div>

      <TimeAxis
        points={points}
        relative={relative}
        onSelect={(key) => {
          if (p.views.some((v) => v.spectId === key)) setOpen((o) => (o === key ? null : key));
          else if (p.spare.some((s) => s.key === key)) p.onAddSession(key);
        }}
      />
      {relative && points.length > 0 && <InfoText warn details="Injektionszeit fehlt (Header oder Eingabe oben): Die Achse zeigt Stunden ab der ersten Aufnahme, die Dosimetrie braucht die Zeit nach Injektion.">Injektionszeit fehlt</InfoText>}
      {p.suggestionDiffers && (
        <div className="button-row">
          <button className="secondary-btn" disabled={p.busy} onClick={p.onApplySuggestion}>
            Zuordnung aus den Aufnahmen übernehmen
          </button>
          <InfoText details="Setzt die Zeitpunkte neu aus der automatischen Gruppierung (FrameOfReference, Studie, Aufnahmezeit): je Aufnahme mit Funktionsbild ein Zeitpunkt mit CT, Organkarte und Läsionsbild. Manuelle Zeit- und Dauerangaben bleiben erhalten.">Vorschlag</InfoText>
        </div>
      )}
      {!p.views.length && !p.spare.length && <p className="tool-hint">Erst SPECT- oder PET-Daten der Therapie mit den zugehörigen CTs laden.</p>}

      {p.views.map((v, n) => {
        const expanded = open === v.spectId;
        return (
          <div key={v.spectId} className={`dos-tp-card${expanded ? " open" : ""}`}>
            <button className="dos-tp-head" onClick={() => setOpen(expanded ? null : v.spectId)} aria-expanded={expanded}>
              <strong>T{n + 1}</strong>
              <span className="dos-tp-when">
                {fmtDateTime(v.acqMs)} · <b>{fmtH(v.tH)}</b> p.i.
              </span>
              {v.warnings.length > 0 && <span className="dos-tp-warn" title={v.warnings.join("\n")}>⚠</span>}
            </button>
            <dl className="dos-tp-roles">
              <dt>{v.unit === "Bq/ml" ? "PET/SPECT" : "SPECT"}</dt>
              <dd>
                <RoleSelect value={v.spectId} options={p.options.functional} near={v.acqMs} empty="–" onChange={(id) => id && p.onUpdate(v.spectId, { spectId: id })} />
                <select
                  className="dos-unit"
                  value={v.unitSource === "manuell" ? v.unit : ""}
                  title={`Einheit des Bildes: ${v.unit} (${v.unitSource === "manuell" ? "von Hand" : v.unitSource === "Header" ? "aus dem DICOM-Header" : "nach dem Kamera-Profil"}). ${v.unit === "Bq/ml" ? "Quantitativ – kein Kalibrierfaktor nötig." : "Counts – Kalibrierfaktor (Kamera-Profil) nötig."}`}
                  onChange={(e) => p.onUpdate(v.spectId, { unitOverride: (e.target.value || undefined) as "Counts" | "Bq/ml" | undefined })}
                >
                  <option value="">{v.unitSource === "manuell" ? "automatisch" : `${v.unit} (${v.unitSource})`}</option>
                  <option value="Counts">Counts</option>
                  <option value="Bq/ml">Bq/ml</option>
                </select>
              </dd>
              <dt>CT</dt>
              <dd>
                <RoleSelect value={v.ctId} options={p.options.cts} near={v.acqMs} empty="– keins –" onChange={(id) => p.onUpdate(v.spectId, { ctId: id })} />
              </dd>
              <dt>Organe</dt>
              <dd>
                {v.organSetId || !v.ctId ? (
                  <RoleSelect value={v.organSetId} options={p.options.organs} near={v.acqMs} empty="– keine –" onChange={(id) => p.onUpdate(v.spectId, { organSetId: id })} />
                ) : (
                  <span className="dos-seg">
                    <select className="inline-select" value={model} onChange={(e) => setModel(e.target.value)} title="Modell der CT-Organsegmentierung">
                      {CT_MODELS.map((m) => (
                        <option key={m.id} value={m.id} title={m.label}>
                          {m.label.replace("TotalSegmentator", "TS").replace(" total", "").replace(" Organe", "").replace(/[()]/g, "")}
                        </option>
                      ))}
                    </select>
                    <button className="chip-btn" disabled={p.segRunning} onClick={() => p.onSegment(v.ctId!, model)}>
                      {p.segRunning ? "läuft …" : "segmentieren"}
                    </button>
                  </span>
                )}
              </dd>
              <dt>Läsionen</dt>
              <dd>
                <RoleSelect value={v.lesionSetId} options={p.options.lesions} near={v.acqMs} empty="– keine –" onChange={(id) => p.onUpdate(v.spectId, { lesionSetId: id })} />
              </dd>
            </dl>
            <div className="chip-row">
              <Chip ok={v.tH !== undefined} title="Zeit nach Injektion">
                t p.i.
              </Chip>
              <Chip ok={v.unit === "Bq/ml" ? "na" : v.durationSec !== undefined} title="Aufnahmedauer (nur für Counts nötig)">
                Dauer
              </Chip>
              <Chip ok={v.calibrated} title={v.unit === "Bq/ml" ? "Quantitatives Bild" : "Kamera-Profil (Nuklid und Kalibrierung)"}>
                {v.unit === "Bq/ml" ? "Bq/ml" : "Kalibrierung"}
              </Chip>
              {p.views.length > 1 && (
                <Chip ok={n === 0 ? "na" : v.registered} title={n === 0 ? "Referenz der Registrierung" : "Auf das CT von T1 registriert"}>
                  {n === 0 ? "Referenz" : "registriert"}
                </Chip>
              )}
            </div>
            {v.warnings.map((w) => (
              <p key={w} className="tool-hint tool-warning">
                {w}
              </p>
            ))}
            {expanded && (
              <div className="dos-tp-details">
                <div className="field-row three">
                  <label className="field">
                    t p.i. (h)
                    <input type="text" inputMode="decimal" placeholder={v.tH !== undefined && v.tHoursManual === undefined ? v.tH.toFixed(2) : "fehlt"} value={v.tHoursManual ?? ""} onChange={(e) => p.onUpdate(v.spectId, { tHoursManual: numOrUndef(e.target.value) })} />
                  </label>
                  <label className="field">
                    Dauer (s)
                    <input type="text" inputMode="decimal" placeholder={v.durationSec !== undefined && v.durationSecManual === undefined ? String(Math.round(v.durationSec)) : "fehlt"} value={v.durationSecManual ?? ""} onChange={(e) => p.onUpdate(v.spectId, { durationSecManual: numOrUndef(e.target.value) })} />
                  </label>
                  <label className="checkbox-field" title="Bild bereits auf den Aufnahmebeginn zerfallskorrigiert">
                    <input type="checkbox" checked={v.decayCorrected} onChange={(e) => p.onUpdate(v.spectId, { decayCorrected: e.target.checked })} />
                    <span>zerfallskorr.</span>
                  </label>
                </div>
                <p className="tool-hint">
                  Sichtfeld {fmt(v.fovMBq)} MBq{v.pctInjected !== undefined ? ` (${fmt(v.pctInjected)} % der injizierten Aktivität)` : ""}
                  {v.notes.length ? ` · ${v.notes.join(" · ")}` : ""}
                </p>
                <div className="button-row">
                  <button className="secondary-btn" onClick={() => p.onShow(v.spectId)}>
                    Im Viewer zeigen
                  </button>
                  <button className="link-btn" onClick={() => p.onRemove(v.spectId)}>
                    Zeitpunkt entfernen
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {p.spare.length > 0 && (
        <div className="dos-spare">
          <span className="tool-hint">Weitere Aufnahmen:</span>
          {p.spare.map((s) => (
            <button key={s.key} className="chip-btn" onClick={() => p.onAddSession(s.key)} title="Als Zeitpunkt hinzufügen">
              + {s.label} · {fmtDateTime(s.acqMs)}
            </button>
          ))}
        </div>
      )}

      {p.unassigned.length > 0 && (
        <details className="dos-unassigned">
          <summary>Nicht zugeordnet ({p.unassigned.length})</summary>
          <p className="tool-hint">Ohne Datum oder Bezug zu einer Aufnahme (z. B. NIfTI). Einem Zeitpunkt zuordnen:</p>
          {p.unassigned.map((u) => (
            <div key={u.id} className="dos-unassigned-row">
              <span className="export-item-name" title={u.label}>
                {u.label}
              </span>
              <select
                className="inline-select"
                value=""
                onChange={(e) => {
                  const t = e.target.value;
                  if (t === "new") p.onAddFunctional(u.id);
                  else if (t) p.onAssign(u.id, u.role, t);
                }}
              >
                <option value="">{u.role === "functional" ? "zuordnen …" : u.role === "ct" ? "als CT von …" : "als Labelbild von …"}</option>
                {u.role === "functional" && <option value="new">neuer Zeitpunkt</option>}
                {p.views.map((v, n) => (
                  <option key={v.spectId} value={v.spectId}>
                    {u.role === "functional" ? "Funktionsbild von " : ""}T{n + 1} ({fmtH(v.tH)})
                  </option>
                ))}
              </select>
            </div>
          ))}
        </details>
      )}

      {p.views.length > 1 && (
        <>
          <button className="secondary-btn" disabled={p.busy || !p.views[0].ctId || usable < 2} onClick={p.onRegister}>
            Zeitpunkte registrieren (CT → CT von T1)
          </button>
          <InfoText details="Rigide CT-CT-Registrierung aller Zeitpunkte auf T1; Funktionsbild und Labelbilder eines Zeitpunkts werden mitbewegt. Gleichwertig: im Bereich „Koregistrierung“ mit dem CT von T1 als Basis die CTs der übrigen Zeitpunkte starr registrieren (SPECT, Organkarte und Läsionsbild derselben Aufnahme folgen) – der Status „registriert“ wird hier erkannt. Nötig für die Voxel-Dosiskarte, für Labelbilder, die für alle Zeitpunkte gelten, und für die Zuordnung der Läsionen.">
            Für Voxelkarte und Läsionen nötig
          </InfoText>
        </>
      )}
    </Card>
  );
}
