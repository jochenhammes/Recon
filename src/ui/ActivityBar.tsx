import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { t } from "../i18n";
export interface Activity {
  id: string;
  label: string;
  /** e.g. "Kachel 5/16" or a stage. */
  detail?: string;
  /** 0..1, or null/undefined when unknown. */
  fraction?: number | null;
  /** Tab that owns the job (click target). */
  tab: string;
  /** Error message instead of a running job. */
  error?: string;
}

const DONE_MS = 4000;

/** Header indicator of running jobs (with progress), recently finished jobs and errors. */
export function ActivityBar({ activities, idleText, onOpen }: { activities: Activity[]; idleText?: string; onOpen: (tab: string) => void }) {
  const running = activities.filter((a) => !a.error);
  const errors = activities.filter((a) => a.error);
  // Jobs that just disappeared are shown as "fertig" for a few seconds.
  const prev = useRef<Map<string, Activity>>(new Map());
  const [done, setDone] = useState<(Activity & { until: number })[]>([]);
  const runningKey = running.map((a) => a.id).join("|");
  const errorKey = errors.map((a) => a.id).join("|");
  const latest = useRef(running);
  latest.current = running;
  useEffect(() => {
    const running = latest.current;
    const now = Date.now();
    const ids = new Set(running.map((a) => a.id));
    const errorIds = new Set(errorKey.split("|").map((id) => id.replace(/-error$/, "")));
    const finished = [...prev.current.values()].filter((a) => !ids.has(a.id) && !errorIds.has(a.id)).map((a) => ({ ...a, until: now + DONE_MS }));
    prev.current = new Map(running.map((a) => [a.id, a]));
    if (finished.length) setDone((d) => [...d.filter((x) => x.until > now && !finished.some((f) => f.id === x.id)), ...finished]);
  }, [runningKey, errorKey]);
  useEffect(() => {
    if (!done.length) return;
    const t = setTimeout(() => setDone((d) => d.filter((x) => x.until > Date.now())), DONE_MS + 50);
    return () => clearTimeout(t);
  }, [done]);
  const recent = done.filter((d) => !running.some((a) => a.id === d.id));

  if (!running.length && !errors.length && !recent.length) return <span className="activity-idle">{idleText}</span>;
  return (
    <div className="activity-bar" role="status" aria-live="polite">
      {running.map((a) => (
        <button key={a.id} className="activity-item" title={`${a.label}${a.detail ? ` · ${a.detail}` : ""} – zum Bereich wechseln`} onClick={() => onOpen(a.tab)}>
          <Loader2 size={13} className="spin" />
          <span className="activity-label">{a.label}</span>
          {a.detail && <span className="activity-detail">{a.detail}</span>}
          {a.fraction != null && Number.isFinite(a.fraction) && (
            <>
              <span className="activity-progress" aria-hidden="true">
                <span style={{ width: `${Math.round(Math.min(1, Math.max(0, a.fraction)) * 100)}%` }} />
              </span>
              <span className="activity-pct">{Math.round(Math.min(1, Math.max(0, a.fraction)) * 100)} %</span>
            </>
          )}
        </button>
      ))}
      {recent.map((a) => (
        <button key={`done-${a.id}`} className="activity-item done" onClick={() => onOpen(a.tab)}>
          <Check size={13} />
          <span className="activity-label">{a.label}</span>
          <span className="activity-detail">{t("fertig")}</span>
        </button>
      ))}
      {errors.map((a) => (
        <button key={a.id} className="activity-item error" title={a.error} onClick={() => onOpen(a.tab)}>
          <AlertTriangle size={13} />
          <span className="activity-label">{a.label}</span>
          <span className="activity-detail">{t("Fehler")}</span>
        </button>
      ))}
    </div>
  );
}
