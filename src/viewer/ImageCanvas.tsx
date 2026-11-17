import { type ReactNode, useEffect, useRef, useState } from "react";

import type { ViewTransform } from "./types";

export interface CanvasImage {
  rgba: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  /** Physical height/width ratio of one pixel (1 for square pixels). */
  pixelAspect?: number;
}

/** Maps image pixel coordinates (pixel centers at integers) to CSS pixels on the canvas. */
export type ToScreen = (u: number, v: number) => [number, number];

export interface ImageCanvasProps {
  image: CanvasImage;
  transform: ViewTransform;
  onTransformChange: (t: ViewTransform) => void;
  title: ReactNode;
  /** Optional controls shown in the title bar. */
  actions?: ReactNode;
  /** Orientation letters [top, bottom, left, right]. */
  labels?: [string, string, string, string];
  overlay?: (ctx: CanvasRenderingContext2D, toScreen: ToScreen, scale: number) => void;
  /** Left click/drag at image coordinates. */
  onPoint?: (u: number, v: number) => void;
  onHover?: (u: number, v: number) => void;
  onLeave?: () => void;
  onScroll?: (direction: 1 | -1) => void;
  /** Right-drag (or Alt-drag): window width/level deltas as fractions of the drag distance. */
  onWindowDrag?: (dx: number, dy: number) => void;
  onDoubleClick?: () => void;
  active?: boolean;
}

type Drag = { mode: "point" | "window" | "pan"; lastX: number; lastY: number };

export function ImageCanvas(props: ImageCanvasProps) {
  const { image, transform, onTransformChange, title, actions, labels, overlay } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // React's wheel listener is passive; block page scrolling over the image with a native listener.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const block = (e: WheelEvent) => e.preventDefault();
    canvas.addEventListener("wheel", block, { passive: false });
    return () => canvas.removeEventListener("wheel", block);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.max(1, Math.floor(r.width)), h: Math.max(1, Math.floor(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = image.pixelAspect ?? 1;
  const fit = size.w > 0 ? Math.min(size.w / image.width, size.h / (image.height * aspect)) : 1;
  const sx = fit * transform.zoom;
  const sy = sx * aspect;
  const x0 = (size.w - image.width * sx) / 2 + transform.panX;
  const y0 = (size.h - image.height * sy) / 2 + transform.panY;
  const toImage = (cx: number, cy: number): [number, number] => [(cx - x0) / sx - 0.5, (cy - y0) / sy - 0.5];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    if (!offscreenRef.current) offscreenRef.current = document.createElement("canvas");
    const off = offscreenRef.current;
    off.width = image.width;
    off.height = image.height;
    off.getContext("2d")!.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);

    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.imageSmoothingEnabled = sx < 4;
    ctx.drawImage(off, x0, y0, image.width * sx, image.height * sy);
    overlay?.(ctx, (u, v) => [x0 + (u + 0.5) * sx, y0 + (v + 0.5) * sy], sx);

    if (labels) {
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255, 210, 90, 0.9)";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(labels[0], size.w / 2, 12);
      ctx.fillText(labels[1], size.w / 2, size.h - 10);
      ctx.textAlign = "left";
      ctx.fillText(labels[2], 6, size.h / 2);
      ctx.textAlign = "right";
      ctx.fillText(labels[3], size.w - 6, size.h / 2);
    }
  }, [image, size, sx, sy, x0, y0, overlay, labels]);

  function rel(e: React.MouseEvent | React.WheelEvent): [number, number] {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  return (
    <div className={props.active ? "view-panel active" : "view-panel"}>
      <div className="view-title">
        <span>{title}</span>
        <span className="view-actions">{actions}</span>
      </div>
      <div ref={containerRef} className="view-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="view-canvas"
          onContextMenu={(e) => e.preventDefault()}
          onDoubleClick={() => props.onDoubleClick?.()}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              const [cx, cy] = rel(e);
              const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
              const zoom = Math.min(20, Math.max(0.5, transform.zoom * factor));
              const k = zoom / transform.zoom;
              // Keep the point under the mouse fixed.
              const cxRel = cx - size.w / 2;
              const cyRel = cy - size.h / 2;
              onTransformChange({ zoom, panX: cxRel - (cxRel - transform.panX) * k, panY: cyRel - (cyRel - transform.panY) * k });
            } else {
              props.onScroll?.(e.deltaY > 0 ? 1 : -1);
            }
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            const mode = e.button === 1 || e.shiftKey ? "pan" : e.button === 2 || e.altKey ? "window" : "point";
            drag.current = { mode, lastX: e.clientX, lastY: e.clientY };
            if (mode === "point") {
              const [u, v] = toImage(...rel(e));
              props.onPoint?.(u, v);
            }
          }}
          onMouseMove={(e) => {
            const [cx, cy] = rel(e);
            const [u, v] = toImage(cx, cy);
            props.onHover?.(u, v);
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.lastX;
            const dy = e.clientY - d.lastY;
            d.lastX = e.clientX;
            d.lastY = e.clientY;
            if (d.mode === "point") props.onPoint?.(u, v);
            else if (d.mode === "window") props.onWindowDrag?.(dx, dy);
            else onTransformChange({ ...transform, panX: transform.panX + dx, panY: transform.panY + dy });
          }}
          onMouseUp={() => (drag.current = null)}
          onMouseLeave={() => {
            drag.current = null;
            props.onLeave?.();
          }}
        />
      </div>
    </div>
  );
}
