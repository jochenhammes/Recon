import { useEffect, useState } from "react";
import type { DynamicInfo } from "../dataset/types";

export interface FrameSliderProps {
  dynamic: DynamicInfo;
  /** Selected frame (0-based); undefined = time-weighted mean image. */
  frame: number | undefined;
  onFrameChange: (frame: number | undefined) => void;
  /** Adapt the window to every frame (early frames are much brighter than late ones). */
  autoWindow: boolean;
  onAutoWindowChange: (on: boolean) => void;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Scroll through the frames of a dynamic dataset (slider, step buttons, playback). */
export function FrameSlider({ dynamic, frame, onFrameChange, autoWindow, onAutoWindowChange }: FrameSliderProps) {
  const n = dynamic.frames.length;
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => onFrameChange(frame === undefined || frame >= n - 1 ? 0 : frame + 1), 400);
    return () => clearInterval(t);
  }, [playing, frame, n, onFrameChange]);
  const label =
    frame === undefined
      ? `Mittelbild aller ${n} Frames`
      : `Frame ${frame + 1}/${n} · ${mmss(dynamic.start[frame])}–${mmss(dynamic.start[frame] + dynamic.duration[frame])} (min:s)`;
  return (
    <div className="frame-slider">
      <div className="frame-slider-head">
        <strong>Zeit</strong>
        <span>{label}</span>
      </div>
      <input
        type="range"
        min={-1}
        max={n - 1}
        step={1}
        value={frame ?? -1}
        aria-label="Frame"
        onChange={(e) => {
          const v = Number(e.target.value);
          onFrameChange(v < 0 ? undefined : v);
        }}
      />
      <div className="chip-row">
        <button className="chip-btn" disabled={frame === undefined || frame === 0} onClick={() => onFrameChange(frame! - 1)}>
          ◀ Frame
        </button>
        <button className="chip-btn" disabled={frame === n - 1} onClick={() => onFrameChange(frame === undefined ? 0 : frame + 1)}>
          Frame ▶
        </button>
        <button className="chip-btn" onClick={() => setPlaying((p) => !p)}>
          {playing ? "■ Stopp" : "▶ Abspielen"}
        </button>
        <button className="chip-btn" disabled={frame === undefined} onClick={() => (setPlaying(false), onFrameChange(undefined))}>
          Mittelbild
        </button>
      </div>
      <label className="checkbox-field">
        <input type="checkbox" checked={autoWindow} onChange={(e) => onAutoWindowChange(e.target.checked)} /> Fenster je Frame automatisch anpassen
      </label>
    </div>
  );
}
