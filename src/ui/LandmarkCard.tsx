import { useState } from "react";
import type { Vec3 } from "../core/geometry";
import { LANDMARK_NAMES, type Landmark } from "../registration/landmarks";
import { Card } from "./Card";

export type LandmarkSide = "base" | "moving";

export interface LandmarkCardProps {
  baseLabel: string;
  movingLabel: string;
  baseLandmarks: Landmark[];
  movingLandmarks: Landmark[];
  /** Selected landmark name (shared with the rotation pivot). */
  name: string;
  onNameChange: (name: string) => void;
  /** Fadenkreuz in native coordinates of base and moving dataset (for display). */
  cursorNative: { base: Vec3 | null; moving: Vec3 | null };
  onSet: (side: LandmarkSide) => void;
  onRemove: (side: LandmarkSide, name: string) => void;
  onGoTo: (side: LandmarkSide, name: string) => void;
  onShow: (which: LandmarkSide | "both") => void;
  onCursorToCenter: (side: LandmarkSide) => void;
  onAlignOrigin: () => void;
  /** Rigid fit from ≥ 3 common landmarks: preview of the RMS residual (mm), null if not possible. */
  rigidRms: number | null;
  onAlignRigid: () => void;
  follow: boolean;
  onFollowChange: (v: boolean) => void;
  /** Number of other datasets with the same frame of reference as the moving dataset. */
  followCount: number;
  /** Bounding boxes of base and moving dataset barely overlap. */
  mismatch: boolean;
  onReorient: (side: LandmarkSide, sameFrame: boolean) => void;
  onResetOrigin: (side: LandmarkSide) => void;
  reoriented: { base: boolean; moving: boolean };
  running: boolean;
}

const fmt = (p: Vec3 | null) => (p ? p.map((v) => v.toFixed(1)).join(" / ") : "–");

/** Landmarks as a common origin: align base and moving dataset at the same anatomical point, optionally take the origin into the dataset. */
export function LandmarkCard(props: LandmarkCardProps) {
  const [custom, setCustom] = useState("");
  const names = [...new Set([...LANDMARK_NAMES, ...props.baseLandmarks.map((l) => l.name), ...props.movingLandmarks.map((l) => l.name)])];
  const has = (side: LandmarkSide, n = props.name) => (side === "base" ? props.baseLandmarks : props.movingLandmarks).some((l) => l.name === n);
  const common = props.movingLandmarks.filter((l) => props.baseLandmarks.some((b) => b.name === l.name)).length;
  const disabled = props.running;

  const row = (side: LandmarkSide, label: string, list: Landmark[]) => (
    <div className="dos-tp">
      <strong>{label}</strong>
      <div className="chip-row">
        <button className="chip-btn" disabled={disabled} onClick={() => props.onSet(side)} title="Aktuelle Fadenkreuz-Position als Landmarke speichern">
          Fadenkreuz → {props.name}
        </button>
        <button className="chip-btn" disabled={disabled} onClick={() => props.onShow(side)} title="Nur diesen Datensatz zeigen, um die Landmarke zu finden">
          nur diesen zeigen
        </button>
        <button className="chip-btn" disabled={disabled} onClick={() => props.onCursorToCenter(side)}>
          Fadenkreuz in die Mitte
        </button>
      </div>
      <p className="tool-hint">Fadenkreuz in eigenen Koordinaten: {fmt(side === "base" ? props.cursorNative.base : props.cursorNative.moving)} mm</p>
      {list.length > 0 && (
        <table className="region-table">
          <tbody>
            {list.map((l) => (
              <tr key={l.name}>
                <td>{l.name}</td>
                <td>{fmt(l.p)}</td>
                <td>
                  <button className="link-btn" onClick={() => props.onGoTo(side, l.name)}>
                    hin
                  </button>{" "}
                  <button className="link-btn" disabled={disabled} onClick={() => props.onRemove(side, l.name)}>
                    löschen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(side === "base" ? props.reoriented.base : props.reoriented.moving) && (
        <p className="tool-hint">
          Ursprung wurde in den Datensatz übernommen.{" "}
          <button className="link-btn" disabled={disabled} onClick={() => props.onResetOrigin(side)}>
            zurück auf Original-Ursprung
          </button>
        </p>
      )}
    </div>
  );

  return (
    <Card
      title={<>Ursprung &amp; Landmarken</>}
      persistKey="coreg-landmarks"
      defaultOpen={props.mismatch}
      status={props.mismatch ? { text: "Koordinaten passen nicht", tone: "warn" } : common ? { text: `${common} Landmarke${common === 1 ? "" : "n"}`, tone: "info" } : null}
      info="Liegen zwei Datensätze in verschiedenen Koordinatensystemen (z. B. NIfTI und DICOM derselben Studie), in beiden dieselbe anatomische Landmarke setzen – Nasenspitze bei Ganzkörperdaten, vordere Kommissur (AC) beim Hirn. „Ursprünge zur Deckung bringen“ verschiebt den Datensatz so, dass die Landmarken übereinanderliegen; danach lässt er sich unten um diesen Ursprung drehen. Ab drei gemeinsamen Landmarken werden Drehung und Verschiebung berechnet. Das Ergebnis ist die Startlage für die Koregistrierung. Optional wird der Ursprung (0,0,0) dauerhaft in den Datensatz übernommen (wie SPM „Set origin“), auch für den Export."
    >
      {props.mismatch && <p className="tool-hint tool-warning">Basis und {props.movingLabel} überlappen kaum – die Koordinatensysteme passen nicht zusammen. Landmarken setzen und zur Deckung bringen.</p>}
      <div className="field-row">
        <label className="field">
          Landmarke
          <select value={props.name} onChange={(e) => props.onNameChange(e.target.value)}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
                {has("base", n) ? " · Basis ✓" : ""}
                {has("moving", n) ? " · Datensatz ✓" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Eigene Landmarke
          <input
            type="text"
            value={custom}
            placeholder="Name + Enter"
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && custom.trim()) {
                props.onNameChange(custom.trim());
                setCustom("");
              }
            }}
          />
        </label>
      </div>
      <p className="tool-hint">Landmarke im Viewer anklicken (Fadenkreuz), dann übernehmen. Ansicht: <button className="link-btn" onClick={() => props.onShow("both")}>beide zeigen</button></p>
      {row("base", `Basis: ${props.baseLabel}`, props.baseLandmarks)}
      {row("moving", `Datensatz: ${props.movingLabel}`, props.movingLandmarks)}
      <label className="checkbox-field">
        <input type="checkbox" checked={props.follow} onChange={(e) => props.onFollowChange(e.target.checked)} />
        <span>
          Datensätze derselben Aufnahme mitbewegen (gleiche FrameOfReference{props.followCount ? `: ${props.followCount}` : ": keine"})
        </span>
      </label>
      <div className="button-row">
        <button className="primary-btn" disabled={disabled || !has("base") || !has("moving")} onClick={props.onAlignOrigin}>
          Ursprünge zur Deckung bringen
        </button>
        <button className="secondary-btn" disabled={disabled || props.rigidRms === null} onClick={props.onAlignRigid} title="Drehung und Verschiebung aus allen gemeinsamen Landmarken (≥ 3)">
          Aus {common} Landmarken ausrichten
        </button>
      </div>
      {props.rigidRms !== null && <p className="tool-hint">Rigide Lösung aus {common} Landmarken: Restfehler {props.rigidRms.toFixed(1)} mm (RMS).</p>}
      {common > 0 && common < 3 && <p className="tool-hint">Für eine automatische Drehung mindestens drei gemeinsame Landmarken setzen; sonst unten um den Ursprung drehen.</p>}
      <details>
        <summary>Ursprung dauerhaft in den Datensatz übernehmen</summary>
        <p className="tool-hint">
          Die gewählte Landmarke wird zum Koordinatenursprung (0,0,0) des Datensatzes – wie SPM „Set origin“. Die Lage zu den anderen Datensätzen bleibt
          erhalten; NIfTI-Export und DICOM-Export (neue Serie, neue FrameOfReference) enthalten den neuen Ursprung. Vor einer Normalisierung ausführen.
        </p>
        <div className="button-row">
          <button className="secondary-btn" disabled={disabled || !has("base")} onClick={() => props.onReorient("base", props.follow)}>
            Basis: Ursprung = {props.name}
          </button>
          <button className="secondary-btn" disabled={disabled || !has("moving")} onClick={() => props.onReorient("moving", props.follow)}>
            Datensatz: Ursprung = {props.name}
          </button>
        </div>
      </details>
    </Card>
  );
}
