import * as dicomParser from "dicom-parser";
import { describe, expect, it } from "vitest";
import { Volume3D } from "../viewer/volume";
import { buildReconstructionDicom } from "./dicomWriter";

describe("buildReconstructionDicom", () => {
  it("produces a Part10 file parseable by dicom-parser with correct dims, spacing, and pixel round-trip", () => {
    const nz = 2;
    const ny = 3;
    const nx = 4;
    const data = new Float32Array(nz * ny * nx);
    for (let i = 0; i < data.length; i++) data[i] = i * 1.5;
    const volume = new Volume3D(data, nz, ny, nx, [5, 2, 1]);

    const bytes = buildReconstructionDicom(volume, { studyDate: "20260101", seriesDescription: "FBP hann" });

    const dataSet = dicomParser.parseDicom(bytes, { untilTag: undefined });

    expect(dataSet.string("x00080060")).toBe("OT");
    expect(dataSet.string("x0008103e")).toBe("FBP hann");
    expect(dataSet.uint16("x00280010")).toBe(ny); // Rows
    expect(dataSet.uint16("x00280011")).toBe(nx); // Columns
    expect(dataSet.intString("x00280008")).toBe(nz); // NumberOfFrames
    expect(dataSet.string("x00280030")).toBe("2\\1"); // PixelSpacing row\col

    const slope = dataSet.floatString("x00281053")!;
    const intercept = dataSet.floatString("x00281052")!;

    const pixelDataElement = dataSet.elements.x7fe00010;
    const pixelData = new Uint16Array(
      dataSet.byteArray.buffer,
      dataSet.byteArray.byteOffset + pixelDataElement.dataOffset,
      pixelDataElement.length / 2,
    );
    for (let i = 0; i < data.length; i++) {
      const reconstructed = pixelData[i] * slope + intercept;
      expect(reconstructed).toBeCloseTo(data[i], 1);
    }
  });

  it("does not embed any real patient identifiers", () => {
    const volume = new Volume3D(new Float32Array(8), 2, 2, 2, [1, 1, 1]);
    const bytes = buildReconstructionDicom(volume, { seriesDescription: "OSEM" });
    const dataSet = dicomParser.parseDicom(bytes);
    expect(dataSet.string("x00100010")).toBe("ANONYMIZED");
    expect(dataSet.string("x00100020")).toBe("ANONYMIZED");
  });
});
