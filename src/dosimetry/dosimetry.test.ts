import { describe, expect, it } from "vitest";
import type { VolumeGeometry } from "../core/geometry";
import { Volume3D } from "../viewer/volume";
import { countsToMBq, recoveryFor } from "./calibration";
import { measureRegions } from "./dose";
import { DEFAULT_ENERGIES, THERAPY_NUCLIDES, localDepositionDose, nuclideById } from "./nuclideData";
import { fitTac, hanscheid, madsen, trapezoid } from "./tacFit";

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const LU = { physHalfLifeH: 6.647 * 24 };

describe("time-activity fit", () => {
  const ln2 = Math.LN2;
  it("mono-exponential: exact TIA for 2, 3 and 4 points", () => {
    const f = (t: number) => 100 * Math.exp((-ln2 * t) / 40);
    for (const ts of [[24, 96], [4, 48, 96], [4, 24, 48, 96]]) {
      const r = fitTac(ts, ts.map(f), "mono", LU);
      expect(r.tia).toBeCloseTo((100 * 40) / ln2, 0);
      expect(r.teffH).toBeCloseTo(40, 2);
    }
  });

  it("bi-exponential with uptake recovers the integral; auto picks it when activity rises", () => {
    const f = (t: number) => 100 * (Math.exp(-0.02 * t) - Math.exp(-0.5 * t));
    const ts = [1, 4, 24, 72];
    const r = fitTac(ts, ts.map(f), "auto", LU);
    expect(r.model).toBe("biUptake");
    expect(r.tia).toBeCloseTo(100 * (1 / 0.02 - 1 / 0.5), -1);
  });

  it("noisy data: TIA within 10 % and an uncertainty estimate", () => {
    const f = (t: number) => 100 * Math.exp((-ln2 * t) / 40);
    const ts = [4, 24, 48, 96];
    const noise = [1.03, 0.97, 1.02, 0.98];
    const r = fitTac(ts, ts.map((t, i) => f(t) * noise[i]), "mono", LU);
    expect(Math.abs(r.tia / ((100 * 40) / ln2) - 1)).toBeLessThan(0.1);
    expect(r.tiaSd).toBeGreaterThan(0);
  });

  it("washout is never slower than physical decay", () => {
    const r = fitTac([24, 96], [50, 60], "mono", LU);
    expect(r.teffH!).toBeLessThanOrEqual(6.647 * 24 + 1e-6);
  });

  it("single time point formulas", () => {
    // A(t) = 50 at t = 40 h for T_eff = 40 h → TIA = 100·40/ln2.
    expect(hanscheid(40, 50).tia).toBeCloseTo((100 * 40) / ln2, 6);
    expect(madsen(24, 100 * Math.exp((-ln2 * 24) / 40), 40).tia).toBeCloseTo((100 * 40) / ln2, 6);
  });

  it("trapezoid with tail", () => {
    const r = trapezoid([10, 20], [10, 5], LU);
    // 0→10: 50, 10→20: 75, tail 5/ (ln2/10) = 72.13
    expect(r.tia).toBeCloseTo(50 + 75 + 5 / (ln2 / 10), 6);
  });
});

describe("calibration and dose", () => {
  it("counts → MBq with decay during the acquisition", () => {
    expect(countsToMBq(100, 10, 1e12)).toBeCloseTo(1 / 1000, 9);
    const f = countsToMBq(3600, 10, 3600);
    expect(f).toBeCloseTo((Math.LN2 / 0.5) / (3600 * 10), 9);
  });

  it("recovery coefficients interpolate in log volume and reach 1 for large organs", () => {
    const p = { recovery: [{ volumeMl: 0.5, rc: 0.3 }, { volumeMl: 26.5, rc: 0.8 }] };
    expect(recoveryFor(p, 0.5)).toBeCloseTo(0.3);
    expect(recoveryFor(p, 26.5)).toBeCloseTo(0.8);
    expect(recoveryFor(p, 200)).toBe(1);
    expect(recoveryFor(p, 3)).toBeGreaterThan(0.3);
  });

  it("local deposition: 1 GBq Y-90 fully decaying in 1 kg ≈ 49.7 Gy", () => {
    const tia = (1000 * 64.1) / Math.LN2;
    expect(localDepositionDose(tia, DEFAULT_ENERGIES["Y-90"].electronKeV, 1)).toBeCloseTo(49.7, 0);
  });

  it("ICRP 107 energies are present, checked and consistent (β⁻ ≤ electrons total)", () => {
    for (const id of THERAPY_NUCLIDES) {
      const e = DEFAULT_ENERGIES[id];
      expect(e.verified).toBe(true);
      expect(e.betaKeV!).toBeLessThanOrEqual(e.electronKeV);
      expect(e.electronKeV - e.betaKeV!).toBeLessThan(50);
    }
    expect(DEFAULT_ENERGIES["Lu-177"].electronKeV).toBe(147.92);
    // Half-lives after ICRP 107 (consistent with the energies).
    expect(nuclideById("Lu-177")!.halfLifeSec / 86400).toBeCloseTo(6.647, 6);
    expect(nuclideById("Tb-161")!.halfLifeSec / 86400).toBeCloseTo(6.906, 6);
    expect(nuclideById("I-131")!.halfLifeSec / 86400).toBeCloseTo(8.021, 6);
    expect(nuclideById("Y-90")!.halfLifeSec / 3600).toBeCloseTo(64.1, 6);
  });

  it("region activity and mass from SPECT, labels and CT on different grids", () => {
    const gS: VolumeGeometry = { origin: [0, 0, 0], spacing: [4, 4, 4], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
    const spect = new Volume3D(new Float32Array(10 * 10 * 10).fill(50), 10, 10, 10, [4, 4, 4], gS);
    const gL: VolumeGeometry = { origin: [8, 8, 8], spacing: [2, 2, 2], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
    const lab = new Float32Array(10 * 10 * 10);
    for (let i = 0; i < 1000; i++) lab[i] = i < 500 ? 1 : 2;
    const labels = new Volume3D(lab, 10, 10, 10, [2, 2, 2], gL);
    const ct = new Volume3D(new Float32Array(1000).fill(100), 10, 10, 10, [2, 2, 2], gL);
    // 50 counts × 0.001 MBq/count per 0.064 ml SPECT voxel → 0.78125 MBq/ml; label 1: 500 × 0.008 ml = 4 ml.
    const m = measureRegions({ volume: labels, matrix: I }, { volume: spect, matrix: I }, 0.001, { volume: ct, matrix: I });
    expect(m.get(1)!.volumeMl).toBeCloseTo(4, 6);
    expect(m.get(1)!.activityMBq).toBeCloseTo(4 * 0.78125, 4);
    expect(m.get(1)!.massG).toBeCloseTo(4 * 1.06, 4);
  });
});

describe("SPECT header timing", () => {
  it("reads acquisition and injection time, duration (binary US values) and dose", async () => {
    const dicomParser = await import("dicom-parser");
    const { buildPart10, enc, item, s } = await import("../test/dicomFixtures");
    const { concatBytes } = await import("../export/bytes");
    const { timePointFromHeader } = await import("./calibration");
    const rp = concatBytes([
      enc({ tag: [0x0018, 0x1074], vr: "DS", value: s("DS", "7400000000") }, true),
      enc({ tag: [0x0018, 0x1078], vr: "DT", value: s("DT", "20261101100000") }, true),
    ]);
    const rot = concatBytes([
      enc({ tag: [0x0018, 0x1242], vr: "IS", value: s("IS", "20000") }, true),
      enc({ tag: [0x0054, 0x0053], vr: "US", value: Uint8Array.of(60, 0) }, true),
    ]);
    const bytes = buildPart10({
      rows: 2, cols: 2, frames: 1, pixels: [1, 1, 1, 1],
      extra: [
        { tag: [0x0008, 0x0022], vr: "DA", value: s("DA", "20261102") },
        { tag: [0x0008, 0x0032], vr: "TM", value: s("TM", "100000") },
        { tag: [0x0054, 0x0016], vr: "SQ", value: item(rp) },
        { tag: [0x0054, 0x0052], vr: "SQ", value: item(rot) },
        { tag: [0x0054, 0x0021], vr: "US", value: Uint8Array.of(2, 0) },
      ],
    });
    const h = timePointFromHeader(dicomParser.parseDicom(bytes));
    expect(h.durationSec).toBe(2400);
    expect(((h.acquisitionMs ?? 0) - (h.injectionMs ?? 0)) / 3.6e6).toBeCloseTo(24, 6);
    expect(h.injectedMBq).toBeCloseTo(7400, 6);
  });
});

describe("calibration from a phantom", () => {
  it("is the inverse of countsToMBq, including decay before and during the acquisition", async () => {
    const { calibrationFromPhantom, countsToMBq } = await import("./calibration");
    const half = 6.647 * 86400, cf = 12.5, T = 1800;
    const refMs = Date.UTC(2026, 0, 1, 8), acqMs = refMs + 3 * 3.6e6, a0 = 500;
    const aStart = a0 * Math.exp((-Math.LN2 / half) * 3 * 3600);
    const counts = aStart / countsToMBq(T, cf, half);
    expect(calibrationFromPhantom({ counts, durationSec: T, activityMBq: a0, activityTimeMs: refMs, acquisitionMs: acqMs, halfLifeSec: half })).toBeCloseTo(cf, 9);
    expect(calibrationFromPhantom({ counts: 0, durationSec: T, activityMBq: a0, activityTimeMs: refMs, acquisitionMs: acqMs, halfLifeSec: half })).toBeNaN();
  });
});
