import { describe, expect, it } from "vitest";
import { buildReport, tacSvg } from "./report";

describe("dosimetry report", () => {
  it("contains all mandatory parts and escapes text", () => {
    const html = buildReport({
      patientId: "P<1>",
      created: new Date(2026, 10, 21, 12, 0),
      nuclide: "Lu-177",
      halfLife: "6,647 d",
      electronKeV: 147.92,
      energySource: "ICRP 107",
      calibration: "Profil SPECT-A: 10 cps/MBq",
      injection: "02.11.2026 09:00 · 7400 MBq",
      timePoints: [{ label: "T1", acqText: "03.11.2026 09:00", tH: 24, durationSec: 1200, unit: "Counts", calibration: "8,3e-5", ct: "CT T1", organs: "CT-Organe", registered: "Referenz" }],
      regions: [{ name: "kidney left", volumeMl: 20, massG: 21, rc: 1, t: [24, 48, 96], a: [10, 6.6, 2.9], model: "Monoexponentiell", teffH: 40, tia: 800, tiaSd: 20, doseGy: 3.7, doseSdGy: 0.3, uncertainty: "± 8 % (Fit 2,5 %, Kalibrierung 5 %)", curve: (t) => 15 * Math.exp((-Math.LN2 * t) / 40) }],
      methods: [["Dosis", "lokale Energiedeposition"]],
      uncertaintyInputs: "Kalibrierung 5 %",
    });
    for (const s of ["Dosimetrie-Bericht", "P&lt;1&gt;", "Lu-177", "Zeitpunkte", "kidney left", "Monoexponentiell", "Forschungswerkzeug", "<svg", "lokale Energiedeposition", "Kalibrierung 5 %"]) expect(html).toContain(s);
    expect(html).not.toContain("P<1>");
  });
  it("svg chart has points and curve", () => {
    const svg = tacSvg({ t: [1, 2], a: [5, 3], curve: (t) => 6 - t });
    expect((svg.match(/<circle/g) ?? []).length).toBe(2);
    expect(svg).toContain("<path");
  });
});
