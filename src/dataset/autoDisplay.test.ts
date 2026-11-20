import { describe, expect, it } from "vitest";
import { type DisplayCandidate, boxOverlap, decideDisplay, gridBox } from "./autoDisplay";
import { identityGeometry } from "../core/geometry";

const cand = (box: [number[], number[]], o: Partial<DisplayCandidate> = {}): DisplayCandidate => ({
  anatomical: false,
  labels: false,
  box: box as DisplayCandidate["box"],
  gridKey: JSON.stringify(box),
  ...o,
});
const body = cand([[-250, -250, -900], [250, 250, 0]], { anatomical: true });
const abdomenPet = cand([[-300, -300, -800], [300, 300, -100]]);
const brainPet = cand([[-100, -120, 100], [100, 120, 250]]);
const brainT1 = cand([[-90, -110, 90], [90, 110, 260]], { anatomical: true });

describe("automatic display on loading", () => {
  it("first dataset is the base", () => expect(decideDisplay(brainPet, null, [])).toBe("base"));

  it("PET over the CT of the same region; a second PET stays hidden", () => {
    expect(decideDisplay(abdomenPet, body, [])).toBe("overlay");
    expect(decideDisplay({ ...abdomenPet, gridKey: "x" }, body, [abdomenPet])).toBe("hidden");
  });

  it("datasets from another body region stay hidden", () => {
    expect(decideDisplay(brainPet, body, [])).toBe("hidden");
    expect(decideDisplay(brainT1, body, [])).toBe("hidden");
  });

  it("an MR replaces a functional base of the same region", () => {
    expect(decideDisplay(brainT1, brainPet, [])).toBe("newBase");
    expect(decideDisplay(brainT1, abdomenPet, [])).toBe("hidden");
  });

  it("same FrameOfReference counts as same region", () => {
    const far = cand([[0, 0, 2000], [10, 10, 2010]], { frameOfReference: "1.2.3" });
    expect(decideDisplay(far, { ...body, frameOfReference: "1.2.3" }, [])).toBe("overlay");
  });

  it("label images on a displayed grid are shown", () => {
    const labels = { ...abdomenPet, labels: true };
    expect(decideDisplay(labels, body, [abdomenPet])).toBe("overlay");
    expect(decideDisplay(cand([[-100, -120, 100], [100, 120, 250]], { labels: true }), body, [])).toBe("hidden");
  });

  it("computes box overlap and grid boxes", () => {
    expect(boxOverlap([[0, 0, 0], [10, 10, 10]], [[5, 0, 0], [15, 10, 10]])).toBeCloseTo(0.5);
    expect(gridBox(identityGeometry([2, 2, 2]), [10, 10, 10])).toEqual([[-1, -1, -1], [19, 19, 19]]);
  });

  it("a CT becomes the base over PET or MR (any region); a second CT stays hidden", () => {
    const ct = { ...body, ct: true };
    expect(decideDisplay(ct, abdomenPet, [])).toBe("newBase");
    expect(decideDisplay(ct, brainT1, [])).toBe("newBase");
    expect(decideDisplay({ ...ct, gridKey: "ct2" }, ct, [])).toBe("hidden");
    // An MR does not replace a CT base.
    expect(decideDisplay(brainT1, ct, [])).toBe("hidden");
  });
});
