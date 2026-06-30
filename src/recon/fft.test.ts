import { describe, expect, it } from "vitest";
import { buildRampFilterKernel, fft, filterSinogramSlice, nextPow2 } from "./fft";

describe("nextPow2", () => {
  it("rounds up to the nearest power of two", () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(2)).toBe(2);
    expect(nextPow2(5)).toBe(8);
    expect(nextPow2(64)).toBe(64);
    expect(nextPow2(65)).toBe(128);
  });
});

describe("fft", () => {
  it("round-trips a random real signal (forward then inverse)", () => {
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * i) / n) + 0.5 * Math.cos((6 * Math.PI * i) / n);
    const original = re.slice();

    fft(re, im, false);
    fft(re, im, true);

    for (let i = 0; i < n; i++) {
      expect(re[i]).toBeCloseTo(original[i], 8);
      expect(im[i]).toBeCloseTo(0, 8);
    }
  });

  it("matches the known DFT of a unit impulse (flat spectrum)", () => {
    const n = 8;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    re[0] = 1;
    fft(re, im, false);
    for (let i = 0; i < n; i++) {
      expect(re[i]).toBeCloseTo(1, 10);
      expect(im[i]).toBeCloseTo(0, 10);
    }
  });

  it("rejects lengths that are not a power of two", () => {
    const re = new Float64Array(6);
    const im = new Float64Array(6);
    expect(() => fft(re, im, false)).toThrow();
  });
});

describe("buildRampFilterKernel", () => {
  it("is zero at DC for every filter variant", () => {
    for (const type of ["ramp", "shepp-logan", "cosine", "hamming", "hann"] as const) {
      const kernel = buildRampFilterKernel(32, type);
      expect(kernel[0]).toBeCloseTo(0, 10);
    }
  });

  it("the plain ramp grows linearly with |frequency| up to Nyquist", () => {
    const kernel = buildRampFilterKernel(16, "ramp");
    expect(kernel[1]).toBeCloseTo(1 / 16, 10);
    expect(kernel[8]).toBeCloseTo(0.5, 10);
    // Mirrored bin near the top should match the corresponding negative frequency.
    expect(kernel[15]).toBeCloseTo(kernel[1], 10);
  });

  it("apodized windows attenuate high frequencies relative to the plain ramp", () => {
    const ramp = buildRampFilterKernel(32, "ramp");
    const hann = buildRampFilterKernel(32, "hann");
    expect(hann[15]).toBeLessThan(ramp[15]);
  });
});

describe("filterSinogramSlice", () => {
  it("preserves a constant (DC-only) projection row at roughly zero after high-pass ramp filtering", () => {
    const cols = 16;
    const numAngles = 1;
    const slice = new Float32Array(cols).fill(5);
    const out = filterSinogramSlice(slice, numAngles, cols, "ramp");
    // A ramp filter has zero DC gain, so a constant row should collapse toward zero.
    for (let c = 4; c < cols - 4; c++) {
      expect(Math.abs(out[c])).toBeLessThan(1);
    }
  });
});
