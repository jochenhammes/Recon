import { describe, expect, it } from "vitest";
import { Volume3D } from "../viewer/volume";
import { acquisitionTime, autoModality, formatAcquisitionTime, guessNiftiModality, isAnatomical, middleEllipsis, modalityLabel, shortName } from "./describe";
import type { LoadedDataset, VolumeSource } from "./types";
import { autoMipId } from "../viewer/mipChoice";

const vol = (fill: (i: number) => number) => new Volume3D(Float32Array.from({ length: 1000 }, (_, i) => fill(i)), 10, 10, 10, [2, 2, 2]);
const positive = vol((i) => (i % 7) * 3);

describe("NIfTI modality guess", () => {
  it("uses a BIDS sidecar first", () => {
    expect(guessNiftiModality("x.nii", positive, { sidecar: '{"Modality":"PT"}' })).toBe("PT");
    expect(guessNiftiModality("x.nii", positive, { sidecar: '{"TracerName":"FDG"}' })).toBe("PT");
    expect(guessNiftiModality("x.nii", positive, { sidecar: '{"MagneticFieldStrength":3}' })).toBe("MR");
  });

  it("recognizes common file names", () => {
    expect(guessNiftiModality("sub-01_ses-1_pet.nii.gz", positive)).toBe("PT");
    expect(guessNiftiModality("sub-01_T1w.nii.gz", positive)).toBe("MR");
    expect(guessNiftiModality("patient_ct.nii", positive)).toBe("CT");
    expect(guessNiftiModality("datscan_spect.nii", positive)).toBe("NM");
    // No false hits inside words.
    expect(guessNiftiModality("subject_inspect.nii", positive)).toBeUndefined();
  });

  it("falls back to dynamics and the value range", () => {
    expect(guessNiftiModality("scan.nii", positive, { dynamic: true })).toBe("PT");
    expect(guessNiftiModality("scan.nii", vol((i) => (i < 300 ? -1000 : i < 900 ? 40 : 1200)))).toBe("CT");
    expect(guessNiftiModality("scan.nii", positive)).toBeUndefined();
  });

  it("user choice overrides the guess", () => {
    const nifti = { headerBytes: new Uint8Array(), littleEndian: true, datatype: 16, sclSlope: 1, sclInter: 0 };
    expect(modalityLabel({ kind: "nifti", fileName: "a.nii", nifti })).toBe("NIfTI");
    expect(modalityLabel({ kind: "nifti", fileName: "a.nii", nifti, modalityGuess: "PT" })).toBe("PT");
    expect(modalityLabel({ kind: "nifti", fileName: "a.nii", nifti, modalityGuess: "PT", modality: "NM" })).toBe("NM");
  });
});

describe("display names", () => {
  it("strips folders and extensions and shortens in the middle", () => {
    expect(shortName("data/sub-01_pet.nii.gz")).toBe("sub-01_pet");
    expect(shortName("IM0001.dcm")).toBe("IM0001");
    expect(shortName("Serie (12 Dateien)")).toBe("Serie (12 Dateien)");
    const m = middleEllipsis("kinetik_test_rezeptor_srtm_long", 20);
    expect(m.length).toBe(20);
    expect(m).toContain("…");
    expect(m.startsWith("kinetik")).toBe(true);
    expect(m.endsWith("long")).toBe(true);
  });
});

describe("modality override", () => {
  it("the chosen modality wins for reconstructions and NIfTI; isAnatomical follows", () => {
    const rec: VolumeSource = { kind: "reconstruction" };
    expect(modalityLabel(rec)).toBe("SPECT");
    expect(modalityLabel({ ...rec, modality: "CT" })).toBe("CT");
    expect(isAnatomical({ ...rec, modality: "CT" })).toBe(true);
    expect(autoModality({ ...rec, modality: "CT" })).toBe("SPECT");
    const nii = { kind: "nifti", fileName: "x.nii", nifti: {} as never, modalityGuess: "PT" } as VolumeSource;
    expect(modalityLabel(nii)).toBe("PT");
    expect(modalityLabel({ ...nii, modality: "MR" } as VolumeSource)).toBe("MR");
  });
});

describe("automatic MIP dataset", () => {
  it("PET before SPECT before CT, shown first, labels excluded, else the base", () => {
    expect(autoMipId([{ id: "ct", modality: "CT" }, { id: "spect", modality: "NM" }, { id: "pet", modality: "PT" }], "ct")).toBe("pet");
    expect(autoMipId([{ id: "ct", modality: "CT" }, { id: "rec", modality: "SPECT" }], "ct")).toBe("rec");
    expect(autoMipId([{ id: "mr", modality: "MR" }, { id: "ct", modality: "CT" }], "mr")).toBe("ct");
    expect(autoMipId([{ id: "lab", modality: "PT", excluded: true }, { id: "mr", modality: "MR" }], "mr")).toBe("mr");
    expect(autoMipId([{ id: "pet1", modality: "PT" }, { id: "pet2", modality: "PT" }], undefined)).toBe("pet1");
  });
});

describe("acquisition date/time", () => {
  const dicom = (files: Record<string, string>[]) =>
    ({
      source: { kind: "dicom", layout: "series", files: files.map((t) => ({ dataSet: { string: (tag: string) => t[tag] } })) },
    }) as unknown as LoadedDataset;

  it("takes the earliest AcquisitionDate/-Time of a series", () => {
    const a = acquisitionTime(dicom([{ x00080022: "20261121", x00080032: "143205.25" }, { x00080022: "20261121", x00080032: "143159" }]))!;
    expect(a).toEqual({ date: "20261121", time: "143159", field: "Acquisition" });
    expect(formatAcquisitionTime(a)).toBe("21.11.2026, 14:31:59 Uhr");
    expect(formatAcquisitionTime(a, true)).toBe("21.11.26 14:31");
  });

  it("reads AcquisitionDateTime and falls back to series/study date", () => {
    expect(acquisitionTime(dicom([{ x0008002a: "20250102091500.000000+0100" }]))).toEqual({ date: "20250102", time: "091500.000000", field: "Acquisition" });
    const s = acquisitionTime(dicom([{ x00080021: "20240301", x00080031: "0812" }]))!;
    expect(s.field).toBe("Series");
    expect(formatAcquisitionTime(s)).toBe("01.03.2024, 08:12 Uhr");
    expect(formatAcquisitionTime(acquisitionTime(dicom([{ x00080020: "20240301" }]))!)).toBe("01.03.2024");
  });

  it("has no date for NIfTI and reconstructions", () => {
    expect(acquisitionTime({ source: { kind: "reconstruction" } } as LoadedDataset)).toBeUndefined();
  });
});
