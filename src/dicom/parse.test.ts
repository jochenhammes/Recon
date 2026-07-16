import * as dicomParser from "dicom-parser";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DicomParseError, decodeJpegLosslessFrame, mergeProjectionSets, parseSpectDicom } from "./parse";
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
    // Detector 1 is offset by 360°/2 = 180° (evenly-spaced dual-head fallback).
    expect(det1Angles).toEqual([180, 270, 0, 90]);
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
      // Use distinct per-detector start angles so the code uses DetectorInformationSequence offsets
      // (not the same-angle fallback) and the test stays focused on AngularViewVector step mapping.
      detectorInfo: [{ startAngleDeg: 0 }, { startAngleDeg: 180 }],
    });

    const set = parseSpectDicom(bytes, "synthetic-rotation.dcm");

    const anglesInFrameOrder = set.frames.map((f) => f.angleDeg);
    // det0 steps from 0°; det1 steps from 180°; both increment by 15° per view index.
    expect(anglesInFrameOrder).toEqual([0, 180, 15, 195, 30, 210, 45, 225]);
  });

  it("ignores DetectorInformationSequence StartAngle when all detectors share the same value", () => {
    // Real-world case: some vendors echo the shared gantry start angle into every detector's
    // DetectorInformationSequence.StartAngle entry rather than each head's true mounting position.
    // When all detectors have the same StartAngle, the values carry no head-position information
    // and both heads end up assigned identical angle sequences → 180°-rotated ghost in FBP.
    // The parser must detect this and apply the evenly-spaced fallback (d × 360°/N) instead.
    const rows = 2;
    const cols = 2;
    const detectorVector = [0, 1, 0, 1, 0, 1];
    const angularViewVector = [1, 1, 2, 2, 3, 3];
    const bytes = buildSyntheticNmDicom({
      rows,
      cols,
      pixelSpacingMm: [4.8, 4.8],
      detectorVector,
      frameValues: detectorVector.map(() => 1),
      numDetectors: 2,
      rotationGroups: [{ startAngleDeg: 0, angularStepDeg: 30, direction: "CCW", framesInRotation: 3 }],
      rotationVector: detectorVector.map(() => 1),
      angularViewVector,
      // Both detectors have the same StartAngle (gantry echo, not head position).
      detectorInfo: [{ startAngleDeg: 0 }, { startAngleDeg: 0 }],
    });

    const set = parseSpectDicom(bytes, "synthetic-same-startangle.dcm");

    const det0Angles = set.frames.filter((f) => f.detector === 0).map((f) => f.angleDeg);
    const det1Angles = set.frames.filter((f) => f.detector === 1).map((f) => f.angleDeg);
    // Fallback: det0 → 0°+0=0°, det1 → 0°+180°=180°.
    expect(det0Angles).toEqual([0, 30, 60]);
    expect(det1Angles).toEqual([180, 210, 240]);
  });

  it("falls back to evenly-spaced detector offsets (360/N) when DetectorInformationSequence has no StartAngle", () => {
    // Reproduces the common real-world case: RotationInformationSequence is present, but
    // DetectorInformationSequence is absent. Without the fallback offset, both detectors would
    // receive identical angle sequences and the FBP would double-expose every voxel at its
    // 180°-rotated mirror position (anterior-posterior ghost image).
    const rows = 2;
    const cols = 2;
    const detectorVector = [0, 1, 0, 1, 0, 1];
    const angularViewVector = [1, 1, 2, 2, 3, 3];
    const bytes = buildSyntheticNmDicom({
      rows,
      cols,
      pixelSpacingMm: [4.8, 4.8],
      detectorVector,
      frameValues: detectorVector.map(() => 1),
      numDetectors: 2,
      rotationGroups: [{ startAngleDeg: 0, angularStepDeg: 30, direction: "CCW", framesInRotation: 3 }],
      rotationVector: detectorVector.map(() => 1),
      angularViewVector,
      // No detectorInfo supplied → no per-detector StartAngle in DetectorInformationSequence.
    });

    const set = parseSpectDicom(bytes, "synthetic-no-detectorinfo.dcm");

    const det0Angles = set.frames.filter((f) => f.detector === 0).map((f) => f.angleDeg);
    const det1Angles = set.frames.filter((f) => f.detector === 1).map((f) => f.angleDeg);
    // Detector 0: 0°, 30°, 60° (from group start).
    expect(det0Angles).toEqual([0, 30, 60]);
    // Detector 1: group start + 180° fallback offset → 180°, 210°, 240°.
    expect(det1Angles).toEqual([180, 210, 240]);
  });

  it("offsets each detector's angles by its own DetectorInformationSequence StartAngle", () => {
    const rows = 2;
    const cols = 2;
    // Mirrors the real-world 180-degree-opposed dual-head case: both detectors share one
    // rotation group and independently restart AngularViewVector at 1, so without per-detector
    // StartAngle they would get identical angle sequences instead of ~180-degree-offset ones.
    const detectorVector = [0, 0, 1, 1];
    const angularViewVector = [1, 2, 1, 2];
    const bytes = buildSyntheticNmDicom({
      rows,
      cols,
      pixelSpacingMm: [4.8, 4.8],
      detectorVector,
      frameValues: detectorVector.map(() => 1),
      numDetectors: 2,
      rotationGroups: [{ startAngleDeg: -180, angularStepDeg: 10, direction: "CCW", framesInRotation: 2 }],
      rotationVector: detectorVector.map(() => 1),
      angularViewVector,
      detectorInfo: [{ startAngleDeg: -180 }, { startAngleDeg: 0 }],
    });

    const set = parseSpectDicom(bytes, "synthetic-detector-offset.dcm");

    const det0Angles = set.frames.filter((f) => f.detector === 0).map((f) => f.angleDeg);
    const det1Angles = set.frames.filter((f) => f.detector === 1).map((f) => f.angleDeg);
    expect(det0Angles).toEqual([180, 190]);
    expect(det1Angles).toEqual([0, 10]);
  });

  it("mirrors pixel columns for a detector whose ImageOrientationPatient row-direction is flipped", () => {
    const rows = 2;
    const cols = 3;
    const detectorVector = [0, 1];
    // Detector 0: unmirrored row-direction (reference). Detector 1: flipped row-direction.
    const detectorInfo = [
      { imageOrientationPatient: [1, 0, 0, 0, 1, 0] as [number, number, number, number, number, number] },
      { imageOrientationPatient: [-1, 0, 0, 0, 1, 0] as [number, number, number, number, number, number] },
    ];
    const det0Frame = [1, 2, 3, 4, 5, 6];
    const det1Frame = [1, 2, 3, 4, 5, 6];
    const bytes = buildSyntheticNmDicom({
      rows,
      cols,
      pixelSpacingMm: [4.8, 4.8],
      detectorVector,
      frameValues: [0, 0],
      numDetectors: 2,
      detectorInfo,
      framePixelsOverride: [det0Frame, det1Frame],
    });

    const set = parseSpectDicom(bytes, "synthetic-mirror.dcm");

    expect(Array.from(set.frames[0].pixels)).toEqual(det0Frame);
    // Detector 1's rows should be reversed: [1,2,3,4,5,6] -> [3,2,1,6,5,4].
    expect(Array.from(set.frames[1].pixels)).toEqual([3, 2, 1, 6, 5, 4]);
  });

  it("does NOT flip columns for ~180°-opposed heads despite opposite ImageOrientationPatient row-directions", () => {
    // Regression test for the AP-ghost / starburst artifact:
    // Siemens H-SPECT stores all frames in the patient frame (consistent column direction),
    // but DetectorInformationSequence.ImageOrientationPatient reflects each head's physical
    // orientation at start — naturally opposite for 180°-opposed heads. The IOP-based flip
    // must be suppressed when startAngles are ~180° apart; the Radon conjugate relation
    // g(θ+180°, t) = g(θ, −t) keeps the data geometrically consistent without mirroring.
    const rows = 2;
    const cols = 3;
    const detectorVector = [0, 1];
    const detectorInfo = [
      {
        startAngleDeg: 180,
        imageOrientationPatient: [1, 0, 0, 0, 1, 0] as [number, number, number, number, number, number],
      },
      {
        startAngleDeg: 0,
        imageOrientationPatient: [-1, 0, 0, 0, 1, 0] as [number, number, number, number, number, number],
      },
    ];
    const det0Frame = [1, 2, 3, 4, 5, 6];
    const det1Frame = [7, 8, 9, 10, 11, 12];
    const bytes = buildSyntheticNmDicom({
      rows,
      cols,
      pixelSpacingMm: [4.8, 4.8],
      detectorVector,
      frameValues: [0, 0],
      numDetectors: 2,
      detectorInfo,
      framePixelsOverride: [det0Frame, det1Frame],
    });

    const set = parseSpectDicom(bytes, "synthetic-180-opposed.dcm");

    // Neither detector should be flipped: data is in patient frame despite opposite IOP.
    expect(Array.from(set.frames[0].pixels)).toEqual(det0Frame);
    expect(Array.from(set.frames[1].pixels)).toEqual(det1Frame);
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

describe("decodeJpegLosslessFrame", () => {
  it("decodes a real encapsulated JPEG-Lossless (Process 14) fragment via dicom-parser", () => {
    // Fixture from https://github.com/rii-mango/JPEGLosslessDecoderJS (MIT), used upstream to
    // verify transfer syntax 1.2.840.10008.1.2.4.57 decoding: 256x256, 16-bit signed, 1 fragment.
    const fixturePath = fileURLToPath(new URL("./fixtures/jpeg-lossless-sel1.dcm", import.meta.url));
    const byteArray = new Uint8Array(readFileSync(fixturePath));
    const dataSet = dicomParser.parseDicom(byteArray);
    const pixelDataElement = dataSet.elements["x7fe00010"];
    expect(pixelDataElement.encapsulatedPixelData).toBe(true);

    const fragment = dicomParser.readEncapsulatedImageFrame(
      dataSet,
      pixelDataElement,
      0,
      pixelDataElement.basicOffsetTable,
    );
    const decoded = decodeJpegLosslessFrame(fragment);

    expect(decoded.byteLength).toBe(256 * 256 * 2);
    const view = new DataView(decoded);
    const first10 = Array.from({ length: 10 }, (_, i) => view.getInt16(i * 2, true));
    expect(first10).toEqual([1024, 1024, 1024, 1025, 1024, 1024, 1025, 1024, 1024, 1024]);
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
