import { describe, expect, it } from "vitest";
import { computeHistogram, computeStats } from "./stats";

describe("computeStats", () => {
  it("handles odd length", () => {
    const s = computeStats(Float32Array.from([5, 1, 3, 2, 4]));
    expect(s).toMatchObject({ count: 5, nonFinite: 0, min: 1, max: 5, mean: 3, median: 3 });
  });

  it("averages the two middle values for even length", () => {
    const s = computeStats(Float32Array.from([10, -2, 4, 7]));
    expect(s.median).toBe(5.5);
    expect(s.min).toBe(-2);
    expect(s.max).toBe(10);
    expect(s.mean).toBeCloseTo(4.75);
  });

  it("handles constant volumes and many duplicates", () => {
    expect(computeStats(new Float32Array(1000).fill(7)).median).toBe(7);
    const data = new Float32Array(10001);
    for (let i = 0; i < data.length; i++) data[i] = i % 3;
    expect(computeStats(data).median).toBe(1);
  });

  it("matches a sorted reference on random data", () => {
    const data = new Float32Array(4097);
    for (let i = 0; i < data.length; i++) data[i] = Math.round(Math.random() * 100) - 30;
    const sorted = Array.from(data).sort((a, b) => a - b);
    expect(computeStats(data).median).toBe(sorted[2048]);
  });

  it("excludes non-finite values", () => {
    const s = computeStats(Float32Array.from([1, NaN, 3, Infinity]));
    expect(s.count).toBe(4);
    expect(s.nonFinite).toBe(2);
    expect(s.median).toBe(2);
    expect(s.max).toBe(3);
  });
});

describe("computeHistogram", () => {
  it("counts every finite value exactly once", () => {
    const data = Float32Array.from([0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const h = computeHistogram(data, { bins: 5 });
    expect(h.edges[0]).toBe(0);
    expect(h.edges[5]).toBe(10);
    expect(Array.from(h.counts)).toEqual([3, 2, 2, 2, 3]);
  });

  it("can exclude zeros and use an explicit range", () => {
    const data = Float32Array.from([0, 0, 0, 1, 2, 50]);
    const h = computeHistogram(data, { bins: 2, min: 0, max: 4, excludeZero: true });
    expect(Array.from(h.counts)).toEqual([1, 1]);
    expect(h.outOfRange).toBe(1);
  });
});
