import type { Vec3 } from "../core/geometry";
import { LANDMARK_1, LANDMARK_2, type Landmark } from "../registration/landmarks";
import { Card } from "./Card";

export type LandmarkSide = "base" | "moving";

export interface LandmarkCardProps {
  baseLabel: string;
  movingLabel: string;
  baseLandmarks: Landmark[];
  movingLandmarks: Landmark[];
  /** Landmark mode: the viewer shows only `view`; clicks set the cross-hair for the landmark. */
  mode: boolean;
  onModeChange: (on: boolean) => void;
  view: LandmarkSide;
  onViewChange: (side: LandmarkSide) => void;
  /** Sets landmark 1 or 2 of the dataset shown at the cross-hair. */
  onSet: (name: string) => void;
  onGoTo: (side: LandmarkSide, name: string) => void;
  onRemove: (side: LandmarkSide, name: string) => void;
  onOriginToLandmark1: () => void;
  onAlignWithLandmark2: () => void;
  /** Result of the last alignment (shown as feedback). */
  feedback: string | null;
  follow: boolean;
  onFollowChange: (v: boolean) => void;
  followCount: number;
  /** Bounding boxes of base and moving dataset barely overlap. */
  mismatch: boolean;
  onReorient: (side: LandmarkSide, sameFrame: boolean) => void;
  onResetOrigin: (side: LandmarkSide) => void;
  reoriented: { base: boolean; moving: boolean };
  running: boolean;
}

const fmt = (p: Vec3) => p.map((v) => v.toFixed(1)).join(" / ");
const NAMES = [LANDMARK_1, LANDMARK_2];

/** Two landmarks per dataset as common origin and direction; see MANUAL.md chapter 5. */
export function LandmarkCard(props: LandmarkCardProps) {
  const find = (side: LandmarkSide, name: string) => (side === "base" ? props.baseLandmarks : props.movingLandmarks).find((l) => l.name === name);
  const both = (name: string) => !!find("base", name) && !!find("moving", name);
  const label = (side: LandmarkSide) => (side === "base" ? `Basis: ${props.baseLabel}` : `Datensatz: ${props.movingLabel}`);
  const disabled = props.running;

  const overview = (
    <table className="region-table landmark-table">
      <thead>
        <tr>
          <th />
          <th>Basis</th>
          <th>Datensatz</th>
        </tr>
      </thead>
      <tbody>
        {NAMES.map((n) => (
          <tr key={n}>
            <td>{n}</td>
            {(["base", "moving"] as LandmarkSide[]).map((side) => {
              const l = find(side, n);
              return (
                <td key={side}>
                  {l ? (
                    <button className="link-btn" title={`Fadenkreuz auf ${n} (${fmt(l.p)} mm)`} onClick={() => props.onGoTo(side, n)}>
                      ✓ zeigen
                    </button>
                  ) : (
                    "–"
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <Card
      title={<>Ursprung &amp; Landmarken</>}
      persistKey="coreg-landmarks"
      status={props.mismatch ? { text: "Koordinaten passen nicht", tone: "warn" } : both(LANDMARK_1) ? { text: "Landmarken gesetzt", tone: "info" } : null}
      info={
        <>
          Für Datensätze, deren Koordinatensysteme nicht zusammenpassen (z. B. NIfTI und DICOM derselben Studie). In beiden Datensätzen dieselben
          zwei anatomischen Punkte markieren – etwa Landmarke 1 = Nasenspitze und Landmarke 2 = Scheitel (Ganzkörper) bzw. vordere und hintere
          Kommissur (Hirn). „Ursprung setzen auf Landmarke 1“ verschiebt den Datensatz, bis seine Landmarke 1 auf der Landmarke 1 der Basis liegt.
          „Mit Landmarke 2 ausrichten“ dreht ihn zusätzlich um Landmarke 1, bis auch die Richtung zur Landmarke 2 stimmt. Eine verbleibende Drehung
          um diese Achse unten in der manuellen Korrektur (Drehpunkt Landmarke 1) korrigieren; danach koregistrieren.
        </>
      }
    >
      {props.mismatch && (
        <p className="tool-hint tool-warning">
          Basis und {props.movingLabel} liegen fast ohne Überlappung – die Koordinatensysteme passen nicht zusammen. Landmarken setzen.
        </p>
      )}

      {!props.mode ? (
        <>
          {overview}
          <button className="primary-btn" disabled={disabled} onClick={() => props.onModeChange(true)}>
            Landmarken setzen …
          </button>
        </>
      ) : (
        <div className="landmark-mode">
          <p className="tool-hint">
            <strong>Schritt 1:</strong> Datensatz wählen – der Viewer zeigt nur diesen. <strong>Schritt 2:</strong> im Viewer auf den Punkt klicken
            (Fadenkreuz), dann „Landmarke hier setzen“.
          </p>
          <div className="segmented-control" role="group" aria-label="Angezeigter Datensatz">
            {(["base", "moving"] as LandmarkSide[]).map((side) => (
              <button key={side} className={props.view === side ? "active" : ""} onClick={() => props.onViewChange(side)}>
                {side === "base" ? "Basis" : "Datensatz"}
              </button>
            ))}
          </div>
          <p className="tool-hint">Im Viewer: {label(props.view)}</p>
          {NAMES.map((n) => {
            const l = find(props.view, n);
            return (
              <div key={n} className="landmark-row">
                <button className={l ? "secondary-btn" : "primary-btn"} disabled={disabled} onClick={() => props.onSet(n)}>
                  {n} hier setzen
                </button>
                {l ? (
                  <span className="tool-hint">
                    gesetzt ·{" "}
                    <button className="link-btn" onClick={() => props.onGoTo(props.view, n)}>
                      zeigen
                    </button>{" "}
                    ·{" "}
                    <button className="link-btn" disabled={disabled} onClick={() => props.onRemove(props.view, n)}>
                      löschen
                    </button>
                  </span>
                ) : (
                  <span className="tool-hint">noch nicht gesetzt</span>
                )}
              </div>
            );
          })}
          {overview}
          <button className="secondary-btn" onClick={() => props.onModeChange(false)}>
            Fertig – beide Datensätze zeigen
          </button>
        </div>
      )}

      <div className="button-row">
        <button className="primary-btn" disabled={disabled || !both(LANDMARK_1)} onClick={props.onOriginToLandmark1} title="Verschiebt den Datensatz so, dass seine Landmarke 1 auf der Landmarke 1 der Basis liegt">
          Ursprung setzen auf Landmarke 1
        </button>
        <button className="secondary-btn" disabled={disabled || !both(LANDMARK_1) || !both(LANDMARK_2)} onClick={props.onAlignWithLandmark2} title="Zusätzlich um Landmarke 1 drehen, bis die Richtung zur Landmarke 2 übereinstimmt">
          Mit Landmarke 2 ausrichten
        </button>
      </div>
      {!both(LANDMARK_1) && <p className="tool-hint">Dafür Landmarke 1 in Basis und Datensatz setzen.</p>}
      {props.feedback && <p className="tool-hint landmark-feedback">{props.feedback}</p>}

      <label className="checkbox-field">
        <input type="checkbox" checked={props.follow} onChange={(e) => props.onFollowChange(e.target.checked)} />
        <span>Datensätze derselben Aufnahme mitverschieben ({props.followCount ? `${props.followCount} mit gleicher FrameOfReference` : "keine vorhanden"})</span>
      </label>

      <details>
        <summary>Ursprung dauerhaft in die Datei übernehmen (optional)</summary>
        <p className="tool-hint">
          Wie SPM „Set origin“: Landmarke 1 wird zum Koordinatenursprung (0,0,0) des Datensatzes. Die Lage zu den anderen Datensätzen bleibt gleich;
          der Export (NIfTI, DICOM als neue Serie) enthält den neuen Ursprung. Vor einer Normalisierung ausführen.
        </p>
        <div className="button-row">
          <button className="secondary-btn" disabled={disabled || !find("base", LANDMARK_1)} onClick={() => props.onReorient("base", props.follow)}>
            Basis: Ursprung = Landmarke 1
          </button>
          <button className="secondary-btn" disabled={disabled || !find("moving", LANDMARK_1)} onClick={() => props.onReorient("moving", props.follow)}>
            Datensatz: Ursprung = Landmarke 1
          </button>
        </div>
        {(["base", "moving"] as LandmarkSide[]).map((side) =>
          (side === "base" ? props.reoriented.base : props.reoriented.moving) ? (
            <p key={side} className="tool-hint">
              {label(side)}: Ursprung übernommen.{" "}
              <button className="link-btn" disabled={disabled} onClick={() => props.onResetOrigin(side)}>
                zurück auf Original-Ursprung
              </button>
            </p>
          ) : null,
        )}
      </details>
    </Card>
  );
}
