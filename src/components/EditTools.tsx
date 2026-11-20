import { useMemo, useState } from "react";
import { Card } from "../ui/Card";
import type { VolumeStats } from "../analysis/stats";
import type { Vec3 } from "../core/geometry";
import { type EditOp, type ValueRule, type VoiAction, changesGrid, countAffected, describeEdit } from "../edit/operations";
import type { VoiStats } from "../edit/voi";
import type { Volume3D } from "../viewer/volume";
import { formatCount, formatValue, parseInput } from "./format";

/** Above this fraction of affected voxels the user must confirm the edit. */
const LARGE_EDIT_FRACTION = 0.01;

interface Units {
  /** display = raw × scale */
  scale: number;
  unitLabel: string;
}

function confirmLarge(affected: number, total: number): boolean {
  const fraction = affected / Math.max(total, 1);
  if (fraction <= LARGE_EDIT_FRACTION) return true;
  const percent = (fraction * 100).toLocaleString("de-DE", { maximumFractionDigits: 2 });
  return window.confirm(
    `Achtung: ${formatCount(affected)} Voxel (${percent} % des Datensatzes) wären betroffen.\n\n` +
      "Stimmen Grenzwerte, Bereich und Einheit?\n\nTrotzdem anwenden?",
  );
}

function AffectedHint({ affected, total }: { affected: number | null; total: number }) {
  if (affected === null) return <p className="tool-hint">Bitte gültige Zahlen eingeben.</p>;
  const fraction = affected / Math.max(total, 1);
  const large = fraction > LARGE_EDIT_FRACTION;
  return (
    <p className={large ? "tool-hint tool-warning" : "tool-hint"}>
      Betroffen: {formatCount(affected)} Voxel ({(fraction * 100).toLocaleString("de-DE", { maximumFractionDigits: 2 })} %)
      {large ? " – ungewöhnlich viel, bitte Grenzwerte und Einheit prüfen." : ""}
    </p>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      {label}
      <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// ─── Values ──────────────────────────────────────────────────────────────────

type ValueMode = ValueRule["kind"];

const VALUE_MODES: { value: ValueMode; label: string }[] = [
  { value: "ge", label: "Werte ≥ Grenzwert ersetzen" },
  { value: "le", label: "Werte ≤ Grenzwert ersetzen" },
  { value: "range", label: "Werte in Bereich [a, b] ersetzen" },
  { value: "clip", label: "Auf Bereich [min, max] begrenzen" },
  { value: "linear", label: "Linear umrechnen: a · x + b" },
];

export interface ValueSectionProps extends Units {
  volume: Volume3D;
  stats: VolumeStats;
  /** Threshold text (display units), shared with the histogram marker. */
  threshold: string;
  onThresholdChange: (v: string) => void;
  value: string;
  onValueChange: (v: string) => void;
  busy: boolean;
  onApply: (op: EditOp) => void;
}

export function ValueSection(props: ValueSectionProps) {
  const { volume, stats, scale, unitLabel, threshold, value, busy } = props;
  const [mode, setMode] = useState<ValueMode>("ge");
  const [a, setA] = useState("0");
  const [b, setB] = useState("1");
  const unit = unitLabel ? ` (${unitLabel})` : "";

  const op = useMemo<EditOp | null>(() => {
    const t = parseInput(threshold) / scale;
    const v = parseInput(value) / scale;
    const na = parseInput(a);
    const nb = parseInput(b);
    let rule: ValueRule;
    switch (mode) {
      case "ge":
      case "le":
        rule = { kind: mode, threshold: t, value: v };
        break;
      case "range":
        rule = { kind: "range", min: Math.min(na, nb) / scale, max: Math.max(na, nb) / scale, value: v };
        break;
      case "clip":
        rule = { kind: "clip", min: Math.min(na, nb) / scale, max: Math.max(na, nb) / scale };
        break;
      case "linear":
        rule = { kind: "linear", a: na, b: nb / scale };
        break;
    }
    return Object.values(rule).every((x) => typeof x === "string" || Number.isFinite(x)) ? { type: "value", rule } : null;
  }, [mode, threshold, value, a, b, scale]);

  const affected = useMemo(() => (op ? countAffected(volume, op) : null), [volume, op]);
  const sliderMin = Number.isFinite(stats.min) ? stats.min * scale : 0;
  const sliderMax = Number.isFinite(stats.max) ? stats.max * scale : 1;
  const displayThreshold = parseInput(threshold);

  function changeMode(m: ValueMode) {
    setMode(m);
    if (m === "range" || m === "clip") {
      setA(String(Number((stats.min * scale).toPrecision(6))));
      setB(String(Number((stats.max * scale).toPrecision(6))));
    } else if (m === "linear") {
      setA("1");
      setB("0");
    }
  }

  return (
    <Card title={<>Werte</>}>
      <label className="field">
        Operation
        <select value={mode} onChange={(e) => changeMode(e.target.value as ValueMode)}>
          {VALUE_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {(mode === "ge" || mode === "le") && (
        <label className="field">
          Grenzwert ({mode === "ge" ? "≥" : "≤"}){unit}
          <input type="text" inputMode="decimal" value={threshold} onChange={(e) => props.onThresholdChange(e.target.value)} />
          <input
            type="range"
            min={sliderMin}
            max={sliderMax}
            step={(sliderMax - sliderMin) / 1000 || 1}
            value={Number.isFinite(displayThreshold) ? Math.min(Math.max(displayThreshold, sliderMin), sliderMax) : sliderMax}
            onChange={(e) => props.onThresholdChange(e.target.value)}
            aria-label="Grenzwert"
          />
        </label>
      )}
      {(mode === "range" || mode === "clip") && (
        <div className="field-row">
          <TextInput label={`${mode === "range" ? "a" : "Min"}${unit}`} value={a} onChange={setA} />
          <TextInput label={`${mode === "range" ? "b" : "Max"}${unit}`} value={b} onChange={setB} />
        </div>
      )}
      {mode === "linear" && (
        <div className="field-row">
          <TextInput label="Faktor a" value={a} onChange={setA} />
          <TextInput label={`Summand b${unit}`} value={b} onChange={setB} />
        </div>
      )}
      {(mode === "ge" || mode === "le" || mode === "range") && <TextInput label={`Neuer Wert${unit}`} value={value} onChange={props.onValueChange} />}
      <AffectedHint affected={affected} total={stats.count} />
      <button
        className="primary-btn"
        disabled={!op || !affected || busy}
        onClick={() => op && affected !== null && confirmLarge(affected, stats.count) && props.onApply(op)}
      >
        Anwenden
      </button>
    </Card>
  );
}

// ─── VOI ─────────────────────────────────────────────────────────────────────

export type VoiTool = "sphere" | "box" | "brush";

export interface BrushState {
  active: boolean;
  radius: number;
  erase: boolean;
}

export interface VoiSectionProps extends Units {
  tool: VoiTool;
  onToolChange: (t: VoiTool) => void;
  sphereRadius: number;
  onSphereRadiusChange: (r: number) => void;
  boxSize: Vec3;
  onBoxSizeChange: (s: Vec3) => void;
  brush: BrushState;
  onBrushChange: (b: BrushState) => void;
  /** Places a sphere/box VOI at the crosshair. */
  onPlace: () => void;
  onClear: () => void;
  hasVoi: boolean;
  stats: VoiStats | null;
  totalVoxels: number;
  countFor: (region: "inside" | "outside", action: VoiAction) => number | null;
  busy: boolean;
  onApply: (region: "inside" | "outside", action: VoiAction) => void;
  onCrop: () => void;
}

export function VoiSection(props: VoiSectionProps) {
  const { tool, scale, unitLabel, stats, busy } = props;
  const [region, setRegion] = useState<"inside" | "outside">("inside");
  const [actionKind, setActionKind] = useState<"set" | "scale">("set");
  const [amount, setAmount] = useState("0");
  const unit = unitLabel ? ` ${unitLabel}` : "";
  const parsed = parseInput(amount);
  const action = useMemo<VoiAction | null>(
    () => (Number.isFinite(parsed) ? (actionKind === "set" ? { kind: "set", value: parsed / scale } : { kind: "scale", factor: parsed }) : null),
    [parsed, actionKind, scale],
  );
  const { countFor, hasVoi } = props;
  const affected = useMemo(() => (hasVoi && action ? countFor(region, action) : null), [hasVoi, region, action, countFor]);

  return (
    <Card title={<>VOI (Volume of Interest)</>}>
      <div className="segmented-control" role="group" aria-label="VOI-Werkzeug">
        {(
          [
            ["sphere", "Kugel"],
            ["box", "Quader"],
            ["brush", "Pinsel"],
          ] as [VoiTool, string][]
        ).map(([t, label]) => (
          <button key={t} className={tool === t ? "active" : ""} onClick={() => props.onToolChange(t)}>
            {label}
          </button>
        ))}
      </div>
      {tool === "sphere" && (
        <>
          <label className="field">
            Radius (mm)
            <input type="number" min={1} step={1} value={props.sphereRadius} onChange={(e) => props.onSphereRadiusChange(Number(e.target.value))} />
          </label>
          <button className="secondary-btn" onClick={props.onPlace}>
            Kugel am Fadenkreuz setzen
          </button>
        </>
      )}
      {tool === "box" && (
        <>
          <div className="field-row three">
            {(["R–L", "A–P", "F–H"] as const).map((label, a) => (
              <label key={label} className="field">
                {label} (mm)
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={props.boxSize[a]}
                  onChange={(e) => {
                    const s = [...props.boxSize] as Vec3;
                    s[a] = Number(e.target.value);
                    props.onBoxSizeChange(s);
                  }}
                />
              </label>
            ))}
          </div>
          <button className="secondary-btn" onClick={props.onPlace}>
            Quader am Fadenkreuz setzen
          </button>
        </>
      )}
      {tool === "brush" && (
        <>
          <label className="field">
            Pinselradius (mm)
            <input type="number" min={1} step={1} value={props.brush.radius} onChange={(e) => props.onBrushChange({ ...props.brush, radius: Number(e.target.value) })} />
          </label>
          <div className="button-row">
            <button className={props.brush.active && !props.brush.erase ? "secondary-btn toggled" : "secondary-btn"} onClick={() => props.onBrushChange({ ...props.brush, active: !(props.brush.active && !props.brush.erase), erase: false })}>
              Malen
            </button>
            <button className={props.brush.active && props.brush.erase ? "secondary-btn toggled" : "secondary-btn"} onClick={() => props.onBrushChange({ ...props.brush, active: !(props.brush.active && props.brush.erase), erase: true })}>
              Radieren
            </button>
          </div>
          <p className="tool-hint">{props.brush.active ? "Im Bild mit gedrückter linker Maustaste malen (schichtweise). Werkzeug erneut anklicken zum Beenden." : "Malen aktivieren, dann im Bild zeichnen."}</p>
        </>
      )}
      {props.hasVoi && stats && (
        <>
          <dl className="summary-list voi-stats">
            <dt>Volumen</dt>
            <dd>
              {formatValue(stats.volumeMl)} ml ({formatCount(stats.voxels)} Voxel)
            </dd>
            <dt>Mittelwert</dt>
            <dd>{formatValue(stats.mean * scale) + unit}</dd>
            <dt>Maximum</dt>
            <dd>{formatValue(stats.max * scale) + unit}</dd>
            <dt>Minimum</dt>
            <dd>{formatValue(stats.min * scale) + unit}</dd>
            <dt>Peak (1 ml)</dt>
            <dd>{formatValue(stats.peak * scale) + unit}</dd>
          </dl>
          <div className="field-row">
            <label className="field">
              Bereich
              <select value={region} onChange={(e) => setRegion(e.target.value as "inside" | "outside")}>
                <option value="inside">innen</option>
                <option value="outside">außen</option>
              </select>
            </label>
            <label className="field">
              Aktion
              <select
                value={actionKind}
                onChange={(e) => {
                  const k = e.target.value as "set" | "scale";
                  setActionKind(k);
                  setAmount(k === "set" ? "0" : "1");
                }}
              >
                <option value="set">Wert setzen</option>
                <option value="scale">skalieren</option>
              </select>
            </label>
          </div>
          <TextInput label={actionKind === "set" ? `Wert${unit ? ` (${unitLabel})` : ""}` : "Faktor"} value={amount} onChange={setAmount} />
          <AffectedHint affected={affected} total={props.totalVoxels} />
          <button
            className="primary-btn"
            disabled={!action || !affected || busy}
            onClick={() => action && affected !== null && confirmLarge(affected, props.totalVoxels) && props.onApply(region, action)}
          >
            Auf VOI anwenden
          </button>
          <div className="button-row">
            <button className="secondary-btn" disabled={busy} onClick={props.onCrop}>
              Auf VOI zuschneiden
            </button>
            <button className="secondary-btn" onClick={props.onClear}>
              VOI löschen
            </button>
          </div>
        </>
      )}
      {props.hasVoi && !stats && <p className="tool-hint">VOI ist leer.</p>}
    </Card>
  );
}

// ─── Filter & geometry ───────────────────────────────────────────────────────

export function FilterSection({ busy, onApply }: { busy: boolean; onApply: (op: EditOp) => void }) {
  const [fwhm, setFwhm] = useState("6");
  const v = parseInput(fwhm);
  return (
    <Card title={<>Filter</>} defaultOpen={false} persistKey="edit-filter">
      <TextInput label="Gauß-Glättung, FWHM (mm)" value={fwhm} onChange={setFwhm} />
      <button className="primary-btn" disabled={!(v > 0) || busy} onClick={() => onApply({ type: "gaussian", fwhmMm: v })}>
        Glätten
      </button>
    </Card>
  );
}

export interface GeometryTarget {
  id: string;
  label: string;
  /** Default selection (templates are left out by default). */
  defaultOn: boolean;
  /** Reason the dataset cannot take part (e.g. dynamic data). */
  disabledReason?: string;
  /** Hint shown next to the dataset (e.g. "Standardraum: eigene Mitte"). */
  note?: string;
}

export type GeometryAction = { kind: "flip"; patientAxis: 0 | 1 | 2 } | { kind: "rotate"; turns: number } | { kind: "resample"; spacing: Vec3 };

export function GeometrySection({
  volume,
  targets,
  activeId,
  busy,
  onApply,
}: {
  volume: Volume3D;
  targets: GeometryTarget[];
  activeId: string;
  busy: boolean;
  onApply: (action: GeometryAction, ids: string[]) => void;
}) {
  const [spacing, setSpacing] = useState(() => volume.geometry.spacing.map((s) => String(Number(s.toPrecision(4)))));
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [included, setIncluded] = useState<Set<string>>(() => new Set());
  const isOn = (t: GeometryTarget) => !t.disabledReason && (t.defaultOn ? !excluded.has(t.id) : included.has(t.id));
  const toggle = (t: GeometryTarget, on: boolean) => {
    const upd = (set: Set<string>, add: boolean) => {
      const n = new Set(set);
      if (add) n.add(t.id);
      else n.delete(t.id);
      return n;
    };
    if (t.defaultOn) setExcluded((s) => upd(s, !on));
    else setIncluded((s) => upd(s, on));
  };
  const ids = targets.filter(isOn).map((t) => t.id);
  const none = ids.length === 0;
  const run = (a: GeometryAction) => onApply(a, ids);

  const parsed = spacing.map(parseInput) as Vec3;
  const valid = parsed.every((s) => s > 0);
  const dims = valid ? [volume.nx, volume.ny, volume.nz].map((n, a) => Math.max(1, Math.round((n * volume.geometry.spacing[a]) / parsed[a]))) : null;
  const usable = targets.filter((t) => !t.disabledReason);
  return (
    <Card
      title={<>Geometrie</>}
      info="Spiegeln, Drehen und Resampling wirken auf alle angehakten Datensätze gemeinsam: Gespiegelt bzw. gedreht wird um die Mitte des aktiven Datensatzes, so dass übereinanderliegende Datensätze (z. B. PET und CT) deckungsgleich bleiben. Datensätze in einem anderen Raum (Standardraum) werden um ihre eigene Mitte bearbeitet. Rückgängig macht den Schritt in allen beteiligten Datensätzen rückgängig."
      status={targets.length > 1 ? { text: `${ids.length} von ${usable.length}`, tone: "info" } : null}
      defaultOpen={false}
      persistKey="edit-geometry"
    >
      {targets.length > 1 && (
        <>
          <div className="export-list-head">
            <span>Betroffene Datensätze</span>
            <span>
              <button className="link-btn" disabled={busy} onClick={() => { setExcluded(new Set()); setIncluded(new Set(targets.map((t) => t.id))); }}>
                alle
              </button>{" "}
              ·{" "}
              <button className="link-btn" disabled={busy} onClick={() => { setExcluded(new Set(targets.map((t) => t.id))); setIncluded(new Set()); }}>
                keine
              </button>
            </span>
          </div>
          <div className="imcalc-list export-list">
            {targets.map((t) => (
              <label key={t.id} className="checkbox-field" title={t.disabledReason ?? t.note}>
                <input type="checkbox" disabled={!!t.disabledReason || busy} checked={isOn(t)} onChange={(e) => toggle(t, e.target.checked)} />
                <span className="export-item-name">
                  {t.label}
                  {t.id === activeId ? " (aktiv)" : ""}
                </span>
                {(t.disabledReason || t.note) && <em className="export-item-grid">{t.disabledReason ?? t.note}</em>}
              </label>
            ))}
          </div>
        </>
      )}
      <div className="chip-row">
        <button className="chip-btn" disabled={busy || none} onClick={() => run({ kind: "flip", patientAxis: 0 })}>
          Spiegeln R↔L
        </button>
        <button className="chip-btn" disabled={busy || none} onClick={() => run({ kind: "flip", patientAxis: 1 })}>
          Spiegeln A↔P
        </button>
        <button className="chip-btn" disabled={busy || none} onClick={() => run({ kind: "flip", patientAxis: 2 })}>
          Spiegeln H↔F
        </button>
      </div>
      <div className="chip-row">
        <button className="chip-btn" disabled={busy || none} onClick={() => run({ kind: "rotate", turns: 1 })}>
          ↻ 90°
        </button>
        <button className="chip-btn" disabled={busy || none} onClick={() => run({ kind: "rotate", turns: 3 })}>
          ↺ 90°
        </button>
        <button className="chip-btn" disabled={busy || none} onClick={() => run({ kind: "rotate", turns: 2 })}>
          180°
        </button>
      </div>
      <div className="field-row three">
        {(["x", "y", "z"] as const).map((axis, a) => (
          <TextInput
            key={axis}
            label={`Voxel ${axis} (mm)`}
            value={spacing[a]}
            onChange={(v) => setSpacing((s) => s.map((old, i) => (i === a ? v : old)))}
          />
        ))}
      </div>
      {dims && (
        <p className="tool-hint">
          Neue Matrix (aktiver Datensatz): {dims.join(" × ")} (bisher {volume.nx} × {volume.ny} × {volume.nz})
          {ids.length > 1 ? " · alle angehakten Datensätze erhalten diese Voxelgröße" : ""}
        </p>
      )}
      <button className="primary-btn" disabled={!valid || busy || none} onClick={() => run({ kind: "resample", spacing: parsed })}>
        Resampling
      </button>
    </Card>
  );
}

// ─── History ─────────────────────────────────────────────────────────────────

export function HistorySection(props: Units & { edits: EditOp[]; busy: boolean; onUndo: () => void; onReset: () => void }) {
  const { edits, busy } = props;
  const gridChanged = edits.some(changesGrid);
  return (
    <Card title={<>Verlauf</>} status={edits.length ? { text: `${edits.length} Schritt${edits.length === 1 ? "" : "e"}`, tone: "info" } : null}>
      {busy && <p className="tool-hint">Berechnung läuft …</p>}
      {edits.length === 0 ? (
        <p className="tool-hint">Noch keine Bearbeitung.</p>
      ) : (
        <ol className="edit-history">
          {edits.map((e, i) => (
            <li key={i}>{describeEdit(e, { scale: props.scale, label: props.unitLabel })}</li>
          ))}
        </ol>
      )}
      {gridChanged && <p className="tool-hint" title="Das Voxelraster wurde verändert – der DICOM-Export erzeugt eine neue Serie.">Raster verändert → neue DICOM-Serie</p>}
      <div className="button-row">
        <button className="secondary-btn" disabled={edits.length === 0 || busy} onClick={props.onUndo}>
          Rückgängig
        </button>
        <button className="secondary-btn" disabled={edits.length === 0 || busy} onClick={props.onReset}>
          Original
        </button>
      </div>
    </Card>
  );
}
