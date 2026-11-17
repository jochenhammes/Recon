import { useRef } from "react";
import type { OverviewRow, OverviewVoi } from "./DatasetOverview";

const same = (a: OverviewRow, b: OverviewRow) =>
  a.id === b.id && a.volume === b.volume && a.scale === b.scale && a.unitLabel === b.unitLabel && a.label === b.label && a.matrix.every((v, i) => v === b.matrix[i]);

/** Keeps the previous rows array while nothing relevant changed (display-only updates are ignored). */
export function useStableRows(rows: OverviewRow[]): OverviewRow[] {
  const ref = useRef(rows);
  const prev = ref.current;
  if (rows.length !== prev.length || rows.some((r, i) => !same(r, prev[i]))) ref.current = rows;
  return ref.current;
}

/** Keeps the previous VOI while mask, grid and placement are unchanged. */
export function useStableVoi(voi: OverviewVoi | null): OverviewVoi | null {
  const ref = useRef(voi);
  const p = ref.current;
  const unchanged =
    !!voi &&
    !!p &&
    voi.mask === p.mask &&
    voi.volume === p.volume &&
    voi.label === p.label &&
    voi.w2v.m.every((v, i) => v === p.w2v.m[i]) &&
    voi.w2v.origin.every((v, i) => v === p.w2v.origin[i]) &&
    JSON.stringify(voi.bounds) === JSON.stringify(p.bounds);
  if (!unchanged) ref.current = voi;
  return ref.current;
}
