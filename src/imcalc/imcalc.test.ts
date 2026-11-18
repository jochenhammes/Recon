import { describe, expect, it } from "vitest";
import { combine, groupMeanSd, linear, product, quotient, zScore } from "./imcalc";

const S = (a: number[], scale = 1) => ({ data: Float32Array.from(a), scale });
const arr = (x: Float32Array) => Array.from(x).map((v) => Math.round(v * 1e5) / 1e5);

describe("IMCALC", () => {
  it("linear and two-dataset operations in display units", async () => {
    expect(arr(await linear(S([1, 2, 3], 2), 0.5, 1))).toEqual([2, 3, 4]);
    expect(arr(await combine(S([5, 6]), S([1, 2], 10), 1, -1))).toEqual([-5, -14]);
    expect(arr(await product(S([2, 3]), S([4, 5])))).toEqual([8, 15]);
    // Division by (almost) zero gives 0; NaN inputs give 0.
    expect(arr(await quotient(S([6, 1, NaN]), S([3, 0, 2])))).toEqual([2, 0, 0]);
  });

  it("group mean and sample SD (also n = 2, large offsets)", async () => {
    const r = await groupMeanSd([S([1, 10]), S([3, 10]), S([5, 13])]);
    expect(arr(r.mean)).toEqual([3, 11]);
    expect(arr(r.sd)).toEqual([2, Math.round(Math.sqrt(3) * 1e5) / 1e5]);
    const two = await groupMeanSd([S([4]), S([6])]);
    expect(arr(two.sd)).toEqual([Math.round(Math.SQRT2 * 1e5) / 1e5]);
    // Welford: no cancellation for values with a large common offset.
    const big = await groupMeanSd([S([1e6 + 1]), S([1e6 + 2]), S([1e6 + 3])]);
    expect(big.sd[0]).toBeCloseTo(1, 3);
    await expect(groupMeanSd([S([1])])).rejects.toThrow(/mindestens 2/);
  });

  it("z-score maps", async () => {
    const mean = S([10, 10, 10, 10]);
    const sd = S([2, 2, 0, 2]);
    expect(arr(await zScore(S([10, 14, 50, 6]), mean, sd))).toEqual([0, 2, 0, -2]);
  });

  it("rejects inputs of different size", async () => {
    await expect(combine(S([1, 2]), S([1]), 1, 1)).rejects.toThrow(/unterschiedlich/);
  });
});
