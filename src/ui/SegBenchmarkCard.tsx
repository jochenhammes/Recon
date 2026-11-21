import { useState } from "react";
import { withPatientId } from "../core/exportName";
import { csvText, csvWithInfo } from "../core/csv";
import { CT_MODELS } from "../segmentation/ctSegment";
import type { CtSegBackend } from "../workers/ctseg.worker";
import { BigTable } from "./BigTable";
import { Card } from "./Card";
import { InfoText } from "./Info";
import type { Option } from "./NormalizationPanel";

/** Result of one model in the comparison. */
export interface SegBenchmarkResult {
  modelId: string;
  seconds: number;
  backend: string;
  structures: number;
  error?: string;
  /** Dice per canonical structure name (only with a reference). */
  dice?: Record<string, number>;
}

export interface SegBenchmarkCardProps {
  cts: Option[];
  /** Label datasets with a region table usable as reference. */
  references: Option[];
  running: boolean;
  /** Model currently running (text). */
  progress: string | null;
  results: SegBenchmarkResult[];
  /** Labels of the run (CT, reference) for the CSV. */
  runInfo: { ct: string; reference: string | null } | null;
  onRun: (
    ctId: string,
    referenceId: string | null,
    modelIds: string[],
    backend: CtSegBackend,
    keep: boolean,
  ) => void;
  onCancel: () => void;
}

const fmt = (v: number | undefined, d = 3) =>
  v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(d).replace(".", ",");
const meanOf = (r: SegBenchmarkResult, names: string[]) => {
  const v = names
    .map((n) => r.dice?.[n])
    .filter((x): x is number => x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};

/** Runs several CT segmentation models on one CT and compares runtime and – with a reference label image – Dice. */
export function SegBenchmarkCard(props: SegBenchmarkCardProps) {
  const [ctId, setCtId] = useState<string | null>(null);
  const [refId, setRefId] = useState<string>("");
  const [models, setModels] = useState<string[]>(CT_MODELS.map((m) => m.id));
  const [backend, setBackend] = useState<CtSegBackend>("auto");
  const [keep, setKeep] = useState(false);
  const ct = props.cts.find((c) => c.id === ctId) ?? props.cts[0] ?? null;
  const label = (id: string) => CT_MODELS.find((m) => m.id === id)?.label ?? id;
  const short = (id: string) => CT_MODELS.find((m) => m.id === id)?.short ?? id;
  const ok = props.results.filter((r) => !r.error);
  // Structures scored by all successful models (fair mean), then the union for the table.
  const withDice = ok.filter((r) => r.dice);
  const common = withDice.length
    ? Object.keys(withDice[0].dice!)
        .filter((n) => withDice.every((r) => r.dice![n] !== undefined))
        .sort()
    : [];
  const all = [
    ...new Set(withDice.flatMap((r) => Object.keys(r.dice!))),
  ].sort();

  function downloadCsv() {
    const head = ["Struktur", ...ok.map((r) => label(r.modelId))]
      .map(csvText)
      .join(";");
    const rows = [
      [csvText("Laufzeit (s)"), ...ok.map((r) => r.seconds.toFixed(0))].join(
        ";",
      ),
      [csvText("Strukturen"), ...ok.map((r) => String(r.structures))].join(";"),
      [
        csvText(`Mittlerer Dice (${common.length} gemeinsame Strukturen)`),
        ...ok.map((r) => fmt(meanOf(r, common), 4)),
      ].join(";"),
      ...all.map((n) =>
        [csvText(n), ...ok.map((r) => fmt(r.dice?.[n], 4))].join(";"),
      ),
    ];
    const info: [string, string][] = [
      ["CT", props.runInfo?.ct ?? ""],
      ["Referenz", props.runInfo?.reference ?? "keine"],
      [
        "Berechnung",
        ok.map((r) => `${label(r.modelId)}: ${r.backend}`).join(", "),
      ],
    ];
    const url = URL.createObjectURL(
      new Blob(["﻿" + csvWithInfo([head, ...rows], info)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = withPatientId("Modellvergleich_CT-Segmentierung.csv");
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card
      title={<>Modellvergleich</>}
      defaultOpen={false}
      persistKey="ctseg-benchmark"
      status={
        props.running
          ? { text: "läuft", tone: "run" }
          : ok.length
            ? { text: `${ok.length} Modelle`, tone: "ok" }
            : null
      }
      info={
        <>
          <p>
            Segmentiert ein CT nacheinander mit den gewählten Modellen und
            vergleicht die Laufzeit auf diesem Rechner. Mit einem
            Referenz-Labelbild (z. B. manuelle Segmentierung, als NIfTI mit
            Regionentabelle geladen) wird zusätzlich der Dice-Koeffizient je
            Struktur berechnet.
          </p>
          <p>
            Strukturen werden über ihre Namen zugeordnet
            (TotalSegmentator-Namen; Herzteile → Herz, „right kidney“ →
            kidney_right usw.). Der Mittelwert nutzt nur Strukturen, die alle
            Modelle und die Referenz enthalten. Die Referenz muss im
            Koordinatensystem des CTs liegen.
          </p>
          <p>
            Reproduzierbarer Vergleich auf öffentlichen Daten:
            tools/ctseg-benchmark im Repository.
          </p>
        </>
      }
    >
      {props.cts.length === 0 ? (
        <p className="tool-hint">Kein CT geladen.</p>
      ) : (
        <>
          <label className="field">
            CT
            <select
              value={ct?.id ?? ""}
              disabled={props.running}
              onChange={(e) => setCtId(e.target.value)}
            >
              {props.cts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Referenz
            <select
              value={refId}
              disabled={props.running}
              onChange={(e) => setRefId(e.target.value)}
            >
              <option value="">keine (nur Laufzeit)</option>
              {props.references.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            Modelle
            {CT_MODELS.map((m) => (
              <label
                key={m.id}
                className="checkbox-field"
                title={`${m.info} · ${m.license} · ${m.sizeMb} MB`}
              >
                <input
                  type="checkbox"
                  checked={models.includes(m.id)}
                  disabled={props.running}
                  onChange={(e) =>
                    setModels(
                      e.target.checked
                        ? CT_MODELS.map((x) => x.id).filter(
                            (x) => x === m.id || models.includes(x),
                          )
                        : models.filter((x) => x !== m.id),
                    )
                  }
                />
                {m.label}
              </label>
            ))}
          </div>
          <label className="field">
            Berechnung
            <select
              value={backend}
              disabled={props.running}
              onChange={(e) => setBackend(e.target.value as CtSegBackend)}
            >
              <option value="auto">Automatisch</option>
              <option value="webgpu">WebGPU</option>
              <option value="wasm">CPU</option>
            </select>
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={keep}
              disabled={props.running}
              onChange={(e) => setKeep(e.target.checked)}
            />
            Ergebnisse als Label-Datensätze behalten
          </label>
          {!props.running ? (
            <button
              className="primary-btn"
              disabled={!ct || models.length === 0}
              onClick={() =>
                ct && props.onRun(ct.id, refId || null, models, backend, keep)
              }
            >
              {models.length} {models.length === 1 ? "Modell" : "Modelle"}{" "}
              vergleichen
            </button>
          ) : (
            <>
              <p className="tool-hint">{props.progress ?? "Vorbereitung …"}</p>
              <button className="secondary-btn" onClick={props.onCancel}>
                Abbrechen
              </button>
            </>
          )}
        </>
      )}
      {props.results.some((r) => r.error) && (
        <InfoText
          warn
          details={props.results
            .filter((r) => r.error)
            .map((r) => `${label(r.modelId)}: ${r.error}`)
            .join(" · ")}
        >
          Nicht alle Modelle liefen durch
        </InfoText>
      )}
      {ok.length > 0 && (
        <BigTable title="Modellvergleich CT-Segmentierung" onCsv={downloadCsv}>
          <div style={{ overflowX: "auto" }}>
            <table className="region-table">
              <thead>
                <tr>
                  <th>Struktur</th>
                  {ok.map((r) => (
                    <th key={r.modelId} title={label(r.modelId)}>
                      {short(r.modelId)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Laufzeit</td>
                  {ok.map((r) => (
                    <td key={r.modelId}>
                      {r.seconds.toFixed(0)} s {r.backend}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Strukturen</td>
                  {ok.map((r) => (
                    <td key={r.modelId}>{r.structures}</td>
                  ))}
                </tr>
                {withDice.length > 0 && (
                  <tr className="selected">
                    <td>Ø Dice ({common.length} gemeinsam)</td>
                    {ok.map((r) => (
                      <td key={r.modelId}>{fmt(meanOf(r, common))}</td>
                    ))}
                  </tr>
                )}
                {all.map((n) => (
                  <tr key={n}>
                    <td>{n.replace(/_/g, " ")}</td>
                    {ok.map((r) => (
                      <td key={r.modelId}>{fmt(r.dice?.[n])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </BigTable>
      )}
    </Card>
  );
}
