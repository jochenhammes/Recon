import { useEffect, useMemo, useRef, useState } from "react";
import { SliceCanvas } from "./SliceCanvas";
import type { Volume3D } from "./volume";

export interface MipCanvasProps {
  volume: Volume3D;
  windowMin: number;
  windowMax: number;
  onWindowLevelDrag?: (deltaWindow: number, deltaLevel: number) => void;
}

export function MipCanvas({ volume, windowMin, windowMax, onWindowLevelDrag }: MipCanvasProps) {
  const [azimuthDeg, setAzimuthDeg] = useState(0);
  const [autoRotate, setAutoRotate] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!autoRotate) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setAzimuthDeg((a) => (a + dt * 0.04) % 360);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [autoRotate]);

  const roundedAzimuthDeg = Math.round(azimuthDeg);
  // Memoized on the rounded angle (not azimuthDeg directly) so smooth auto-rotation only
  // triggers a recompute once per whole degree, instead of on every animation-frame tick.
  const mip = useMemo(() => volume.rotatingMip(roundedAzimuthDeg), [volume, roundedAzimuthDeg]);
  const pixelAspectRatio = volume.voxelSpacingMm[0] / volume.voxelSpacingMm[1];

  return (
    <div className="slice-panel">
      <div className="slice-panel-label">
        MIP (rotierend, {Math.round(azimuthDeg)}°)
        <button className="mip-rotate-btn" onClick={() => setAutoRotate((v) => !v)}>
          {autoRotate ? "⏸ Stop" : "▶ Rotieren"}
        </button>
      </div>
      <SliceCanvas
        data={mip.data}
        width={mip.width}
        height={mip.height}
        pixelAspectRatio={pixelAspectRatio}
        windowMin={windowMin}
        windowMax={windowMax}
        onScrollSlice={(dir) => {
          setAutoRotate(false);
          setAzimuthDeg((a) => (a + dir * 5 + 360) % 360);
        }}
        onWindowLevelDrag={onWindowLevelDrag}
      />
      <input
        className="mip-slider"
        type="range"
        min={0}
        max={359}
        value={Math.round(azimuthDeg)}
        onChange={(e) => {
          setAutoRotate(false);
          setAzimuthDeg(Number(e.target.value));
        }}
      />
    </div>
  );
}
