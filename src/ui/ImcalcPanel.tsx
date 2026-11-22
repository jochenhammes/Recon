import { useState } from "react";
import { parseInput } from "../components/format";
import { Card } from "./Card";

import { t, tk } from "../i18n";
import { T } from "../i18n/T";
export interface ImcalcDataset {
  id: string;
  label: string;
  /** Short name for result names. */
  short: string;
  /** Voxel grid key: datasets can be combined only with the same key. */
  gridKey: string;
  gridInfo: string;
  /** Display unit of the values (e.g. SUV, HU). */
  unit: string;
  dynamic: boolean;
}

export type ImcalcJob =
  | { kind: "linear"; id: string; a: number; b: number; name: string }
  | { kind: "pair"; id1: string; id2: string; op: "sum" | "product" | "quotient"; a: number; b: number; name: string }
  | { kind: "group"; ids: string[]; nameMean: string; nameSd: string }
  | { kind: "z"; ids: string[]; meanId: string; sdId: string; suffix: string };

type Mode = ImcalcJob["kind"];

const MODES: [Mode, string][] = [
  ["linear", "Linear"],
  ["pair", tk("Zwei Datensätze")],
  ["group", tk("Gruppe")],
  ["z", "Z-Transformation"],
];

const num = (s: string, fallback: number) => {
  const v = parseInput(s);
  return Number.isFinite(v) ? v : fallback;
};
const fmt = (v: number) => String(v).replace(".", ",");

/** IMCALC: voxelwise arithmetic; every result becomes a new dataset on the grid of the inputs. */
export function ImcalcPanel(props: {
  datasets: ImcalcDataset[];
  busy: boolean;
  status: string | null;
  error: string | null;
  results: { id: string; label: string }[];
  onRun: (job: ImcalcJob) => void;
  onShow: (id: string) => void;
}) {
  const ds = props.datasets;
  const byId = (id: string) => ds.find((d) => d.id === id);
  const [mode, setMode] = useState<Mode>("linear");
  // Linear
  const [linId, setLinId] = useState("");
  const [linA, setLinA] = useState("1");
  const [linB, setLinB] = useState("0");
  // Pair
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [pairOp, setPairOp] = useState<"sum" | "product" | "quotient">("sum");
  const [pA, setPA] = useState("1");
  const [pB, setPB] = useState("-1");
  // Group / z
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [zIds, setZIds] = useState<string[]>([]);
  const [meanId, setMeanId] = useState("");
  const [sdId, setSdId] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [name2, setName2] = useState<string | null>(null);

  const lin = byId(linId) ?? ds[0];
  const d1 = byId(p1) ?? ds[0];
  const sameGrid = (key: string | undefined) => ds.filter((d) => !key || d.gridKey === key);
  const d2 = byId(p2) && byId(p2)!.gridKey === d1?.gridKey ? byId(p2) : sameGrid(d1?.gridKey).find((d) => d.id !== d1?.id);
  const group = groupIds.map(byId).filter((d): d is ImcalcDataset => !!d);
  const groupKey = group[0]?.gridKey;
  const zs = zIds.map(byId).filter((d): d is ImcalcDataset => !!d);
  const zKey = zs[0]?.gridKey;
  const zOptions = sameGrid(zKey);
  const mean = byId(meanId) && zOptions.includes(byId(meanId)!) ? byId(meanId) : zOptions.find((d) => /mittel|mean/i.test(d.label));
  const sd = byId(sdId) && zOptions.includes(byId(sdId)!) ? byId(sdId) : zOptions.find((d) => /\bsd\b|standardabw/i.test(d.label));

  // Suggested result names (editable).
  const opLabel = pairOp === "product" ? "·" : pairOp === "quotient" ? "/" : "";
  const suggested =
    mode === "linear"
      ? `${fmt(num(linA, 1))}·${lin?.short ?? "X"} + ${fmt(num(linB, 0))}`
      : mode === "pair"
        ? pairOp === "sum"
          ? `${fmt(num(pA, 1))}·${d1?.short ?? "X1"} ${num(pB, -1) < 0 ? "−" : "+"} ${fmt(Math.abs(num(pB, -1)))}·${d2?.short ?? "X2"}`
          : `${d1?.short ?? "X1"} ${opLabel} ${d2?.short ?? "X2"}`
        : mode === "group"
          ? t("Gruppe-Mittelwert (n={length})", { length: group.length })
          : "_z";
  const suggested2 = t("Gruppe-SD (n={length})", { length: group.length });
  const outName = name ?? suggested;

  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) => set(on ? [...list, id] : list.filter((x) => x !== id));
  const checkList = (selected: string[], set: (v: string[]) => void, key: string | undefined, exclude: string[] = []) => (
    <div className="imcalc-list">
      {ds
        .filter((d) => !exclude.includes(d.id))
        .map((d) => {
          const incompatible = !!key && d.gridKey !== key;
          return (
            <label key={d.id} className={`checkbox-field${incompatible ? " disabled" : ""}`} title={incompatible ? t("Anderes Raster: {gridInfo}", { gridInfo: d.gridInfo }) : d.gridInfo}>
              <input type="checkbox" checked={selected.includes(d.id)} disabled={props.busy || (incompatible && !selected.includes(d.id))} onChange={(e) => toggle(selected, set, d.id, e.target.checked)} />
              {d.label}
              {d.dynamic && <em className="row-note"> {t("Mittelbild")}</em>}
            </label>
          );
        })}
    </div>
  );
  const select = (value: string | undefined, onChange: (id: string) => void, options: ImcalcDataset[], label: string) => (
    <label className="field">
      {label}
      <select value={value ?? ""} disabled={props.busy} onChange={(e) => onChange(e.target.value)}>
        {!value && <option value="">{t("– wählen –")}</option>}
        {options.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
            {d.unit ? ` [${d.unit}]` : ""}
          </option>
        ))}
      </select>
    </label>
  );

  let job: ImcalcJob | null = null;
  let hint = "";
  if (mode === "linear" && lin) job = { kind: "linear", id: lin.id, a: num(linA, 1), b: num(linB, 0), name: outName };
  if (mode === "pair") {
    if (!d1 || !d2) hint = t("Zweiter Datensatz auf demselben Raster fehlt.");
    else job = { kind: "pair", id1: d1.id, id2: d2.id, op: pairOp, a: num(pA, 1), b: num(pB, -1), name: outName };
  }
  if (mode === "group") {
    if (group.length < 2) hint = t("Mindestens 2 Datensätze anhaken.");
    else job = { kind: "group", ids: group.map((d) => d.id), nameMean: outName, nameSd: name2 ?? suggested2 };
  }
  if (mode === "z") {
    if (!zs.length) hint = "Individuen anhaken.";
    else if (!mean || !sd) hint = t("Mittelwert- und SD-Karte der Vergleichskohorte wählen (gleiches Raster).");
    else job = { kind: "z", ids: zs.map((d) => d.id), meanId: mean.id, sdId: sd.id, suffix: outName };
  }

  return (
    <>
      <Card
        title={<>{t("1 · Operation")}</>}
        info={
          <>
            <p>
              <T k="Voxelweise Rechnung auf Datensätzen mit {b}demselben Raster{/b} (gleiche Matrix und Geometrie). Ergebnisse sind neue Datensätze im selben Bildraum – anzeigen, exportieren, im Projekt speichern und weiterverarbeiten wie alle anderen. Daten verschiedener Patienten vorher in den Standardraum bringen." b={(c) => <strong>{c}</strong>} />
            </p>
            <p>{t("Gerechnet wird in der angezeigten Einheit (SUV, wenn eingestellt; sonst Originalwerte). Dynamische Serien gehen mit ihrem Mittelbild ein.")}</p>
            <p>
              {t("Linear: a·X + b · Zwei Datensätze: a·X₁ + b·X₂, X₁·X₂ oder X₁/X₂ (Division durch ≈ 0 ergibt 0) · Gruppe: voxelweiser Mittelwert und Stichproben-SD (n − 1) · Z-Transformation: (Individuum − Mittelwert)/SD je Individuum; Voxel mit SD ≈ 0 ergeben 0.")}
            </p>
          </>
        }
      >
        <div className="segmented-control imcalc-modes" role="group" aria-label={t("Operation")}>
          {MODES.map(([m, label]) => (
            <button
              key={m}
              className={mode === m ? "active" : ""}
              disabled={props.busy}
              onClick={() => {
                setMode(m);
                setName(null);
                setName2(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {ds.length === 0 && <p className="tool-hint">{t("Keine geeigneten Datensätze (Labelbilder sind ausgenommen).")}</p>}

        {mode === "linear" && ds.length > 0 && (
          <>
            {select(lin?.id, setLinId, ds, t("Datensatz X"))}
            <div className="inline-fields imcalc-coeffs">
              <label className="field">
                a
                <input value={linA} disabled={props.busy} onChange={(e) => setLinA(e.target.value)} />
              </label>
              <label className="field">
                b
                <input value={linB} disabled={props.busy} onChange={(e) => setLinB(e.target.value)} />
              </label>
            </div>
            <p className="tool-hint imcalc-formula">{t("Ergebnis = a · X + b")}</p>
          </>
        )}

        {mode === "pair" && ds.length > 0 && (
          <>
            {select(d1?.id, setP1, ds, t("Datensatz X₁"))}
            {select(d2?.id, setP2, sameGrid(d1?.gridKey).filter((d) => d.id !== d1?.id), t("Datensatz X₂ (gleiches Raster)"))}
            <div className="segmented-control" role="group" aria-label={t("Verknüpfung")}>
              {(
                [
                  ["sum", "a·X₁ + b·X₂"],
                  ["product", "X₁ · X₂"],
                  ["quotient", "X₁ / X₂"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={pairOp === k ? "active" : ""} disabled={props.busy} onClick={() => setPairOp(k)}>
                  {label}
                </button>
              ))}
            </div>
            {pairOp === "sum" && (
              <div className="inline-fields imcalc-coeffs">
                <label className="field">
                  a
                  <input value={pA} disabled={props.busy} onChange={(e) => setPA(e.target.value)} />
                </label>
                <label className="field">
                  b
                  <input value={pB} disabled={props.busy} onChange={(e) => setPB(e.target.value)} />
                </label>
              </div>
            )}
            {pairOp === "sum" && <p className="tool-hint imcalc-formula">a = 1, b = −1: Differenz X₁ − X₂</p>}
          </>
        )}

        {mode === "group" && ds.length > 0 && (
          <>
            <p className="tool-hint">{t("Datensätze der Gruppe anhaken (das erste bestimmt das Raster):")}</p>
            {checkList(groupIds, setGroupIds, groupKey)}
          </>
        )}

        {mode === "z" && ds.length > 0 && (
          <>
            <p className="tool-hint">{t("Individuen anhaken – je Individuum entsteht eine Z-Karte:")}</p>
            {checkList(zIds, setZIds, zKey, [mean?.id ?? "", sd?.id ?? ""])}
            {select(mean?.id, setMeanId, zOptions, t("Mittelwert-Karte der Vergleichskohorte"))}
            {select(sd?.id, setSdId, zOptions, t("SD-Karte der Vergleichskohorte"))}
          </>
        )}

        {ds.length > 0 && (
          <>
            <label className="field">
              {mode === "z" ? t("Namenszusatz der Z-Karten (an den Namen des Individuums)") : mode === "group" ? t("Name der Mittelwert-Karte") : t("Name des Ergebnisses")}
              <input value={outName} disabled={props.busy} onChange={(e) => setName(e.target.value)} />
            </label>
            {mode === "group" && (
              <label className="field">
                {t("Name der SD-Karte")}
                <input value={name2 ?? suggested2} disabled={props.busy} onChange={(e) => setName2(e.target.value)} />
              </label>
            )}
            {hint && <p className="tool-hint">{hint}</p>}
            <button className="primary-btn" disabled={props.busy || !job} onClick={() => job && props.onRun(job)}>
              {props.busy ? t("Wird berechnet …") : mode === "z" && zs.length > 1 ? t("{length} Z-Karten berechnen", { length: zs.length }) : t("Berechnen")}
            </button>
          </>
        )}
        {props.status && <p className="tool-hint">{props.status}</p>}
        {props.error && <div className="error-banner">{props.error}</div>}
      </Card>

      {props.results.length > 0 && (
        <Card title={<>{t("Ergebnisse")}</>} status={{ text: String(props.results.length), tone: "ok" }}>
          <ul className="imcalc-results">
            {props.results.map((r) => (
              <li key={r.id}>
                <span>{r.label}</span>
                <button className="link-btn" onClick={() => props.onShow(r.id)}>
                  {t("einblenden")}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
