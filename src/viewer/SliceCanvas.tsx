import { useEffect, useRef } from "react";
import { windowLevelToRgba } from "./volume";

export interface SliceCanvasProps {
  data: Float32Array;
  width: number;
  height: number;
  /** Physical size ratio (mm/px-height) / (mm/px-width); 1 for isotropic in-plane views. */
  pixelAspectRatio?: number;
  windowMin: number;
  windowMax: number;
  crosshairCol?: number;
  crosshairRow?: number;
  onCrosshairChange?: (col: number, row: number) => void;
  onScrollSlice?: (direction: 1 | -1) => void;
  onWindowLevelDrag?: (deltaWindow: number, deltaLevel: number) => void;
}

const DISPLAY_SIZE = 360;

export function SliceCanvas({
  data,
  width,
  height,
  pixelAspectRatio = 1,
  windowMin,
  windowMax,
  crosshairCol,
  crosshairRow,
  onCrosshairChange,
  onScrollSlice,
  onWindowLevelDrag,
}: SliceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const dragState = useRef<{ mode: "crosshair" | "wl"; lastX: number; lastY: number } | null>(null);

  const physicalHeight = height * pixelAspectRatio;
  const canvasW = physicalHeight >= width ? Math.round(DISPLAY_SIZE * (width / physicalHeight)) : DISPLAY_SIZE;
  const canvasH = physicalHeight >= width ? DISPLAY_SIZE : Math.round(DISPLAY_SIZE * (physicalHeight / width));

  useEffect(() => {
    if (!offscreenRef.current) offscreenRef.current = document.createElement("canvas");
    const offscreen = offscreenRef.current;
    offscreen.width = width;
    offscreen.height = height;
    const offCtx = offscreen.getContext("2d")!;
    const rgba = windowLevelToRgba(data, windowMin, windowMax);
    offCtx.putImageData(new ImageData(rgba, width, height), 0, 0);

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(offscreen, 0, 0, canvasW, canvasH);

    if (crosshairCol !== undefined && crosshairRow !== undefined) {
      const px = (crosshairCol / width) * canvasW;
      const py = (crosshairRow / height) * canvasH;
      ctx.strokeStyle = "rgba(0, 255, 120, 0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 0.5, 0);
      ctx.lineTo(px + 0.5, canvasH);
      ctx.moveTo(0, py + 0.5);
      ctx.lineTo(canvasW, py + 0.5);
      ctx.stroke();
    }
  }, [data, width, height, windowMin, windowMax, crosshairCol, crosshairRow, canvasW, canvasH]);

  function toDataCoords(clientX: number, clientY: number): [number, number] {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const col = Math.round(((clientX - rect.left) / rect.width) * width);
    const row = Math.round(((clientY - rect.top) / rect.height) * height);
    return [Math.max(0, Math.min(width - 1, col)), Math.max(0, Math.min(height - 1, row))];
  }

  return (
    <canvas
      ref={canvasRef}
      className="slice-canvas"
      onWheel={(e) => {
        e.preventDefault();
        onScrollSlice?.(e.deltaY > 0 ? 1 : -1);
      }}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => {
        if (e.button === 2 || e.altKey) {
          dragState.current = { mode: "wl", lastX: e.clientX, lastY: e.clientY };
        } else {
          dragState.current = { mode: "crosshair", lastX: e.clientX, lastY: e.clientY };
          const [col, row] = toDataCoords(e.clientX, e.clientY);
          onCrosshairChange?.(col, row);
        }
      }}
      onMouseMove={(e) => {
        if (!dragState.current) return;
        if (dragState.current.mode === "crosshair") {
          const [col, row] = toDataCoords(e.clientX, e.clientY);
          onCrosshairChange?.(col, row);
        } else {
          const dx = e.clientX - dragState.current.lastX;
          const dy = e.clientY - dragState.current.lastY;
          dragState.current.lastX = e.clientX;
          dragState.current.lastY = e.clientY;
          // Scale sensitivity to the current window width so that ~200 px of drag always spans
          // the full current window range. This keeps coarse adjustment fast for wide windows
          // and gives automatic fine control as the user narrows the window.
          const scale = (windowMax - windowMin) / 200;
          onWindowLevelDrag?.(dx * scale, -dy * scale);
        }
      }}
      onMouseUp={() => (dragState.current = null)}
      onMouseLeave={() => (dragState.current = null)}
    />
  );
}
