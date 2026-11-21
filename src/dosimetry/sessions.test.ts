import { describe, expect, it } from "vitest";
import { groupSessions, hoursPi, type SessionItem } from "./sessions";

const H = 3.6e6;
const t0 = Date.UTC(2026, 10, 20, 10, 0);

describe("acquisition sessions", () => {
  it("groups CT + SPECT + organ map per time point via FrameOfReference and time", () => {
    const items: SessionItem[] = [
      { id: "ct1", role: "ct", acqMs: t0, frameOfReference: "F1" },
      { id: "sp1", role: "functional", acqMs: t0 + 0.2 * H, frameOfReference: "F1" },
      { id: "org1", role: "label", kind: "organs", parentId: "ct1" },
      // second time point: CT and SPECT without common FoR, 20 min apart
      { id: "sp2", role: "functional", acqMs: t0 + 24 * H, frameOfReference: "F2" },
      { id: "ct2", role: "ct", acqMs: t0 + 23.7 * H, frameOfReference: "F3" },
      { id: "les2", role: "label", kind: "lesions", frameOfReference: "F2" },
      // third: SPECT only
      { id: "sp3", role: "functional", acqMs: t0 + 96 * H },
      // NIfTI without anything
      { id: "nii", role: "functional" },
      { id: "lbl", role: "label", kind: "other" },
    ];
    const g = groupSessions(items);
    expect(g.sessions.map((s) => [s.functional, s.cts, s.organs, s.lesions])).toEqual([
      [["sp1"], ["ct1"], ["org1"], []],
      [["sp2"], ["ct2"], [], ["les2"]],
      [["sp3"], [], [], []],
    ]);
    expect(g.sessions[1].acqMs).toBe(t0 + 24 * H);
    expect(g.unassigned.map((u) => u.id).sort()).toEqual(["lbl", "nii"]);
  });

  it("never merges two functional images by time alone, but does via FrameOfReference", () => {
    const g = groupSessions([
      { id: "a", role: "functional", acqMs: t0 },
      { id: "b", role: "functional", acqMs: t0 + 0.5 * H },
      { id: "ct", role: "ct", acqMs: t0 + 0.4 * H },
    ]);
    expect(g.sessions.map((s) => s.functional)).toEqual([["a"], ["b"]]);
    // CT joins the closer one (b)
    expect(g.sessions[1].cts).toEqual(["ct"]);
    const h = groupSessions([
      { id: "a", role: "functional", acqMs: t0, frameOfReference: "F" },
      { id: "b", role: "functional", acqMs: t0 + 0.1 * H, frameOfReference: "F" },
    ]);
    expect(h.sessions).toHaveLength(1);
    expect(h.sessions[0].functional).toEqual(["a", "b"]);
  });

  it("respects different studies and the time window", () => {
    const g = groupSessions([
      { id: "sp", role: "functional", acqMs: t0, studyUid: "S1" },
      { id: "ct", role: "ct", acqMs: t0 + 0.3 * H, studyUid: "S2" },
      { id: "ct2", role: "ct", acqMs: t0 + 3 * H },
    ]);
    expect(g.sessions.map((s) => [s.functional, s.cts])).toEqual([[["sp"], []], [[], ["ct"]], [[], ["ct2"]]]);
  });

  it("hours p.i.", () => {
    expect(hoursPi(t0 + 24 * H, t0)).toBe(24);
    expect(hoursPi(undefined, t0)).toBeUndefined();
  });
});
