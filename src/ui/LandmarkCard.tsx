import type { Vec3 } from "../core/geometry";
import { LANDMARK_1, LANDMARK_2, type Landmark } from "../registration/landmarks";
import { InfoText } from "./Info";

export type LandmarkSide = "base" | "moving";

export interface LandmarkPanelProps {
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
  /** Last landmark step done: 0 = none, 1 = origin on landmark 1, 2 = aligned with landmark 2. */
  step: 0 | 1 | 2;
  /** Continue with the automatic registration (next tab). */
  onNext: () => void;
  running: boolean;
}

const fmt = (p: Vec3) => p.map((v) => v.toFixed(1)).join(" / ");
const NAMES = [LANDMARK_1, LANDMARK_2];

/** Tab "Landmarken": two landmarks per dataset as common origin and direction (see MANUAL.md chapter 5). */
export function LandmarkPanel(props: LandmarkPanelProps) {
  const find = (side: LandmarkSide, name: string) => (side === "base" ? props.baseLandmarks : props.movingLandmarks).find((l) => l.name === name);
  const both = (name: string) => !!find("base", name) && !!find("moving", name);
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
    <>
      <InfoText details="Optional, aber hilfreich vor der automatischen Registrierung – vor allem, wenn die Koordinatensysteme nicht zusammenpassen oder der Datensatz stark verdreht ist. In Basis und Datensatz dieselben zwei Punkte markieren, z. B. Landmarke 1 = Nasenspitze, Landmarke 2 = Scheitel (Hirn: vordere und hintere Kommissur). „Ursprung setzen auf Landmarke 1“ verschiebt, „Mit Landmarke 2 ausrichten“ dreht zusätzlich um Landmarke 1; eine Restdrehung um diese Achse im Reiter „Manuell“ korrigieren.">
        Zwei gleiche Punkte in Basis und Datensatz
      </InfoText>

      {!props.mode ? (
        <>
          {overview}
          <button className={both(LANDMARK_1) ? "secondary-btn" : "primary-btn"} disabled={disabled} onClick={() => props.onModeChange(true)}>
            Landmarken setzen …
          </button>
        </>
      ) : (
        <div className="landmark-mode">
          <InfoText details="Der Viewer zeigt nur den gewählten Datensatz. Im Viewer auf den Punkt klicken (Fadenkreuz), dann „Landmarke … hier setzen“. Markierungen: B1/B2 Basis (orange), D1/D2 Datensatz (türkis).">Punkt anklicken, dann setzen</InfoText>
          <div className="segmented-control" role="group" aria-label="Angezeigter Datensatz">
            {(["base", "moving"] as LandmarkSide[]).map((side) => (
              <button key={side} className={props.view === side ? "active" : ""} onClick={() => props.onViewChange(side)} title={side === "base" ? props.baseLabel : props.movingLabel}>
                {side === "base" ? "Basis" : "Datensatz"}
              </button>
            ))}
          </div>
          {NAMES.map((n) => {
            const l = find(props.view, n);
            return (
              <div key={n} className="landmark-row">
                <button className={l ? "secondary-btn" : "primary-btn"} disabled={disabled} onClick={() => props.onSet(n)}>
                  {n} hier setzen
                </button>
                {l ? (
                  <span className="tool-hint">
                    ✓ ·{" "}
                    <button className="link-btn" onClick={() => props.onGoTo(props.view, n)}>
                      zeigen
                    </button>{" "}
                    ·{" "}
                    <button className="link-btn" disabled={disabled} onClick={() => props.onRemove(props.view, n)}>
                      löschen
                    </button>
                  </span>
                ) : (
                  <span className="tool-hint">–</span>
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
        <button
          className={both(LANDMARK_1) && props.step === 0 ? "primary-btn" : "secondary-btn"}
          disabled={disabled || !both(LANDMARK_1)}
          onClick={props.onOriginToLandmark1}
          title="Verschiebt den Datensatz so, dass seine Landmarke 1 auf der Landmarke 1 der Basis liegt"
        >
          Ursprung setzen auf Landmarke 1
        </button>
        <button
          className={props.step === 1 && both(LANDMARK_2) ? "primary-btn" : "secondary-btn"}
          disabled={disabled || !both(LANDMARK_1) || !both(LANDMARK_2)}
          onClick={props.onAlignWithLandmark2}
          title="Zusätzlich um Landmarke 1 drehen, bis die Richtung zur Landmarke 2 übereinstimmt"
        >
          Mit Landmarke 2 ausrichten
        </button>
      </div>
      {props.step > 0 && (
        <button className={props.step === 2 || !both(LANDMARK_2) ? "primary-btn" : "secondary-btn"} disabled={disabled} onClick={props.onNext}>
          Weiter: automatisch registrieren →
        </button>
      )}
    </>
  );
}
