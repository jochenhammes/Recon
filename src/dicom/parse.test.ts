import { describe, expect, it } from "vitest";
import { DicomParseError, mergeProjectionSets, parseSpectDicom } from "./parse";
import { buildSyntheticNmDicom } from "./testDicomBuilder";

describe("parseSpectDicom", () => {
  it("parses a dual-detector file without rotation geometry (even-spacing fallback)", () => {
    const rows = 2;
    const cols = 4;
    // Frames alternate detector 0/1, 4 frames each; pixel value encodes the frame index for readback checks.
    const detectorVector = [0, 1, 0, 1, 0, 1, 0, 1];
    const frameValues = detectorVector.map((_, i) => i * 10);
    const bytes = buildSyntheticNmDicom({
      rows,
      cols,
      pixelSpacingMm: [4.8, 4.8],
      detectorVector,
      frameValues,
      numDetectors: 2,
    });

    const set = parseSpectDicom(bytes, "synthetic.dcm");

    expect(set.rows).toBe(rows);
    expect(set.cols).toBe(cols);
    expect(set.numDetectors).toBe(2);
    expect(set.frames).toHaveLength(8);
    expect(set.pixelSpacingMm).toEqual([4.8, 4.8]);

    // Each pixel of every frame should equal its encoded value.
    for (let i = 0; i < set.frames.length; i++) {
      const frame = set.frames[i];
      expect(frame.detector).toBe(detectorVector[i]);
      for (const px of frame.pixels) expect(px).toBe(frameValues[i]);
    }

    const det0Angles = set.frames.filter((f) => f.detector === 0).map((f) => f.angleDeg);
    const det1Angles = set.frames.filter((f) => f.detector === 1).map((f) => f.angleDeg);
    expect(det0Angles).toEqual([0, 90, 180, 270]);
    expect(det1Angles).toEqual([0, 90, 180, 270]);
  });

  it("parses angles from RotationInformationSequence + AngularViewVector", () => {
    const rows = 2;
    const cols = 2;
    const detectorVector = [0, 1, 0, 1, 0, 1, 0, 1];
    const angularViewVector = [1, 1, 2, 2, 3, 3, 4, 4];
    const bytes = buildSyntheticNmDicom({
      rows,
      cols,
      pixelSpacingMm: [3.5, 3.5],
      detectorVector,
      frameValues: detectorVector.map(() => 1),
      numDetectors: 2,
      rotationGroups: [{ startAngleDeg: 0, angularStepDeg: 15, direction: "CCW", framesInRotation: 4 }],
      rotationVector: detectorVector.map(() => 1),
      angularViewVector,
    });

    const set = parseSpectDicom(bytes, "synthetic-rotation.dcm");

    const anglesInFrameOrder = set.frames.map((f) => f.angleDeg);
    expect(anglesInFrameOrder).toEqual([0, 0, 15, 15, 30, 30, 45, 45]);
  });

  it("rejects single-frame files", () => {
    const bytes = buildSyntheticNmDicom({
      rows: 2,
      cols: 2,
      pixelSpacingMm: [4.8, 4.8],
      detectorVector: [0],
      frameValues: [1],
      numDetectors: 1,
    });
    expect(() => parseSpectDicom(bytes, "single-frame.dcm")).toThrow(DicomParseError);
  });
});

describe("mergeProjectionSets", () => {
  it("merges multiple single-detector files, reassigning detector index per file", () => {
    const a = parseSpectDicom(
      buildSyntheticNmDicom({
        rows: 2,
        cols: 2,
        pixelSpacingMm: [4.8, 4.8],
        detectorVector: [0, 0],
        frameValues: [1, 2],
        numDetectors: 1,
      }),
      "head1.dcm",
    );
    const b = parseSpectDicom(
      buildSyntheticNmDicom({
        rows: 2,
        cols: 2,
        pixelSpacingMm: [4.8, 4.8],
        detectorVector: [0, 0],
        frameValues: [3, 4],
        numDetectors: 1,
      }),
      "head2.dcm",
    );

    const merged = mergeProjectionSets([a, b]);
    expect(merged.numDetectors).toBe(2);
    expect(merged.frames).toHaveLength(4);
    expect(merged.frames.filter((f) => f.detector === 0)).toHaveLength(2);
    expect(merged.frames.filter((f) => f.detector === 1)).toHaveLength(2);
  });

  it("rejects mismatched image sizes", () => {
    const a = parseSpectDicom(
      buildSyntheticNmDicom({
        rows: 2,
        cols: 2,
        pixelSpacingMm: [4.8, 4.8],
        detectorVector: [0, 0],
        frameValues: [1, 2],
        numDetectors: 1,
      }),
      "a.dcm",
    );
    const b = parseSpectDicom(
      buildSyntheticNmDicom({
        rows: 3,
        cols: 3,
        pixelSpacingMm: [4.8, 4.8],
        detectorVector: [0, 0],
        frameValues: [1, 2],
        numDetectors: 1,
      }),
      "b.dcm",
    );
    expect(() => mergeProjectionSets([a, b])).toThrow(DicomParseError);
  });
});
