import { describe, expect, it } from "vitest";
import { tileTimeLimitSec } from "./ctSegment";
import { inferenceEstimate } from "./infer";

describe("segmentation progress", () => {
  it("interpolates within the running tile from the average tile time", () => {
    const p = { done: 4, total: 16, stage: "Inferenz (CPU)", elapsed: 80, receivedAt: 1_000_000 };
    const e = inferenceEstimate(p, 1_010_000); // 10 s into tile 5, average 20 s
    expect(e.avg).toBe(20);
    expect(e.fraction).toBeCloseTo(4.5 / 16, 6);
    expect(e.remaining).toBeCloseTo(20 * 12 - 10, 6);
    expect(inferenceEstimate(p, 1_100_000).fraction).toBeCloseTo(4.95 / 16, 6); // capped within the tile
    const first = inferenceEstimate({ done: 0, total: 16, stage: "Inferenz", elapsed: 0, receivedAt: 0 }, 600_000);
    expect(first.fraction).toBeGreaterThan(0);
    expect(first.fraction).toBeLessThan(1 / 16);
    expect(first.remaining).toBeUndefined();
  });

  it("watchdog limit: generous for the first tile, a multiple of the average later", () => {
    expect(tileTimeLimitSec(0, 0)).toBe(900);
    expect(tileTimeLimitSec(2, 40)).toBe(180);
    expect(tileTimeLimitSec(2, 200)).toBe(600);
  });
});
