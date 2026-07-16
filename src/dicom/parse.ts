import * as dicomParser from "dicom-parser";
import type { DataSet } from "dicom-parser";
import { Decoder as JpegLosslessDecoder } from "jpeg-lossless-decoder-js";
import type { ProjectionFrame, SpectProjectionSet } from "./types";

/** Transfer syntaxes this parser can decode for encapsulated (compressed) PixelData. */
const JPEG_LOSSLESS_TRANSFER_SYNTAXES = new Set([
  "1.2.840.10008.1.2.4.57", // JPEG Lossless, Non-Hierarchical (Process 14)
  "1.2.840.10008.1.2.4.70", // JPEG Lossless, Non-Hierarchical, First-Order Prediction (Process 14 [Selection Value 1])
]);

const TAG = {
  TransferSyntaxUID: "x00020010",
  Rows: "x00280010",
  Columns: "x00280011",
  NumberOfFrames: "x00280008",
  PixelSpacing: "x00280030",
  BitsAllocated: "x00280100",
  PixelRepresentation: "x00280103",
  Modality: "x00080060",
  PatientID: "x00100020",
  StudyDate: "x00080020",
  Manufacturer: "x00080070",
  Radionuclide: "x00540300",
  PixelData: "x7fe00010",
  DetectorVector: "x00540020",
  NumberOfDetectors: "x00540021",
  RotationVector: "x00540050",
  RotationInformationSequence: "x00540052",
  StartAngle: "x00540200",
  AngularStep: "x00181144",
  RotationDirection: "x00181140",
  NumberOfFramesInRotation: "x00540053",
  AngularViewVector: "x00540090",
  DetectorInformationSequence: "x00540022",
  ImageOrientationPatient: "x00200037",
} as const;

class DicomParseError extends Error {}

/**
 * VR dictionary for the tags this parser reads. Only needed for the (less common but still
 * encountered) Implicit VR Little Endian transfer syntax, where dicom-parser cannot infer VRs
 * on its own and relies on a caller-supplied vrCallback. Ignored for Explicit VR files.
 */
const VR_DICTIONARY: Record<string, string> = {
  [TAG.Rows]: "US",
  [TAG.Columns]: "US",
  [TAG.NumberOfFrames]: "IS",
  [TAG.PixelSpacing]: "DS",
  [TAG.BitsAllocated]: "US",
  [TAG.PixelRepresentation]: "US",
  [TAG.Modality]: "CS",
  [TAG.PatientID]: "LO",
  [TAG.StudyDate]: "DA",
  [TAG.Manufacturer]: "LO",
  [TAG.DetectorVector]: "US",
  [TAG.NumberOfDetectors]: "US",
  [TAG.RotationVector]: "US",
  [TAG.RotationInformationSequence]: "SQ",
  [TAG.StartAngle]: "DS",
  [TAG.AngularStep]: "DS",
  [TAG.RotationDirection]: "CS",
  [TAG.NumberOfFramesInRotation]: "US",
  [TAG.AngularViewVector]: "US",
  [TAG.DetectorInformationSequence]: "SQ",
  [TAG.ImageOrientationPatient]: "DS",
};

function vrCallback(tag: string): string | undefined {
  return VR_DICTIONARY[tag];
}

/**
 * dicom-parser throws plain strings or `{ exception, dataSet }` objects rather than Error
 * instances, so `String(e)` on those yields "[object Object]". Extracts a readable message.
 */
function describeParseError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "exception" in e && typeof e.exception === "string") return e.exception;
  return String(e);
}

function isMissingP10Prefix(e: unknown): boolean {
  const message = describeParseError(e);
  // "DICM prefix not found" covers files long enough to read the 132-byte header where the magic
  // doesn't match; "attempt to read past end of buffer" covers bare datasets too short to even
  // contain a 132-byte Part10 header (readFixedString fails before the magic check runs).
  return message.includes("DICM prefix not found") || message.includes("attempt to read past end of buffer");
}

/** Reads a numeric value that may be encoded as US/UL (binary) or DS/IS (numeric string). */
function readNumeric(dataSet: DataSet, tag: string, index = 0): number | undefined {
  const element = dataSet.elements[tag];
  if (!element) return undefined;
  try {
    switch (element.vr) {
      case "US":
        return dataSet.uint16(tag, index);
      case "UL":
        return dataSet.uint32(tag, index);
      case "SS":
        return dataSet.int16(tag, index);
      case "SL":
        return dataSet.int32(tag, index);
      case "FL":
        return dataSet.float(tag, index);
      case "FD":
        return dataSet.double(tag, index);
      case "DS":
        return dataSet.floatString(tag, index);
      case "IS":
        return dataSet.intString(tag, index);
      default: {
        const s = dataSet.string(tag);
        if (s === undefined) return undefined;
        const parts = s.split("\\");
        const v = parseFloat(parts[index]);
        return Number.isNaN(v) ? undefined : v;
      }
    }
  } catch {
    return undefined;
  }
}

/** Reads a multi-valued numeric (US/UL/DS/IS) element into a plain number array. */
function readNumericArray(dataSet: DataSet, tag: string, expectedLength?: number): number[] | undefined {
  const element = dataSet.elements[tag];
  if (!element) return undefined;
  const out: number[] = [];
  if (element.vr === "US" || element.vr === "SS") {
    const count = element.length / 2;
    for (let i = 0; i < count; i++) out.push(readNumeric(dataSet, tag, i)!);
  } else if (element.vr === "UL" || element.vr === "SL" || element.vr === "FL") {
    const count = element.length / 4;
    for (let i = 0; i < count; i++) out.push(readNumeric(dataSet, tag, i)!);
  } else {
    const s = dataSet.string(tag);
    if (s === undefined) return undefined;
    for (const part of s.split("\\")) {
      const v = parseFloat(part);
      out.push(Number.isNaN(v) ? 0 : v);
    }
  }
  if (expectedLength !== undefined && out.length !== expectedLength) {
    // Some files pad or under-report; trust what's present, caller handles fallback per-frame.
  }
  return out;
}

interface RotationGroup {
  startAngleDeg: number;
  angularStepDeg: number;
  directionSign: 1 | -1;
  framesInRotation?: number;
}

function readRotationInformationSequence(dataSet: DataSet): RotationGroup[] {
  const element = dataSet.elements[TAG.RotationInformationSequence];
  if (!element || !element.items) return [];
  return element.items.map((item) => {
    const itemDataSet = item.dataSet!;
    const startAngleDeg = readNumeric(itemDataSet, TAG.StartAngle) ?? 0;
    const angularStepDeg = readNumeric(itemDataSet, TAG.AngularStep) ?? 0;
    const directionStr = itemDataSet.string(TAG.RotationDirection);
    const directionSign: 1 | -1 = directionStr === "CW" ? -1 : 1;
    const framesInRotation = readNumeric(itemDataSet, TAG.NumberOfFramesInRotation);
    return { startAngleDeg, angularStepDeg, directionSign, framesInRotation };
  });
}

function normalizeAngle(angleDeg: number): number {
  let a = angleDeg % 360;
  if (a < 0) a += 360;
  return a;
}

/** Per-detector geometry, read from DetectorInformationSequence (0054,0022). */
interface DetectorInfo {
  /** This detector head's own absolute start angle, overriding the shared rotation group's value. */
  startAngleDeg?: number;
  /** Row-direction (increasing-column) cosines from ImageOrientationPatient, first 3 of 6 values. */
  rowDirection?: [number, number, number];
}

function readDetectorInformationSequence(dataSet: DataSet): DetectorInfo[] {
  const element = dataSet.elements[TAG.DetectorInformationSequence];
  if (!element || !element.items) return [];
  return element.items.map((item) => {
    const itemDataSet = item.dataSet!;
    const startAngleDeg = readNumeric(itemDataSet, TAG.StartAngle);
    const orientation = readNumericArray(itemDataSet, TAG.ImageOrientationPatient);
    const rowDirection: [number, number, number] | undefined =
      orientation && orientation.length >= 3 ? [orientation[0], orientation[1], orientation[2]] : undefined;
    return { startAngleDeg, rowDirection };
  });
}

/**
 * For each detector, whether its pixel columns must be mirrored (reversed) before merging into a
 * shared sinogram. Mechanically opposed detector heads commonly face the patient from opposite
 * sides, so their row-direction (ImageOrientationPatient) is flipped relative to a reference head;
 * left unmirrored, this would merge geometrically inconsistent column conventions into one sinogram.
 */
function detectorColumnFlips(detectorInfos: DetectorInfo[], numDetectors: number): boolean[] {
  const reference = detectorInfos[0]?.rowDirection;
  const flips: boolean[] = new Array(numDetectors).fill(false);
  if (!reference) return flips;
  for (let d = 0; d < numDetectors; d++) {
    const rowDirection = detectorInfos[d]?.rowDirection;
    if (!rowDirection) continue;
    const dot =
      rowDirection[0] * reference[0] + rowDirection[1] * reference[1] + rowDirection[2] * reference[2];
    flips[d] = dot < 0;
  }
  return flips;
}

/** Reverses each row of a row-major (rows x cols) pixel buffer, leaving the input untouched. */
function mirrorColumns(pixels: Float32Array, rows: number, cols: number): Float32Array {
  const out = new Float32Array(pixels.length);
  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    for (let c = 0; c < cols; c++) out[base + c] = pixels[base + cols - 1 - c];
  }
  return out;
}

/**
 * Computes the absolute projection angle for every frame.
 *
 * Prefers standard DICOM geometry (RotationInformationSequence + RotationVector/AngularViewVector).
 * Falls back to evenly spacing each detector's frames over 360 degrees when the geometry
 * attributes are absent, which covers simplified/legacy exports.
 *
 * For mechanically opposed multi-head cameras, the rotation group's StartAngle often describes
 * only the gantry's own sweep, shared identically across all heads; each head's true absolute
 * start angle (offset by its fixed mounting position) comes from DetectorInformationSequence and,
 * when present, takes precedence over the shared rotation group's StartAngle.
 */
function computeFrameAngles(
  dataSet: DataSet,
  numberOfFrames: number,
  detectorVector: number[],
  detectorInfos: DetectorInfo[],
  numDetectors: number,
): number[] {
  const rotationGroups = readRotationInformationSequence(dataSet);
  const rotationVectorRaw = readNumericArray(dataSet, TAG.RotationVector);
  const angularViewVectorRaw = readNumericArray(dataSet, TAG.AngularViewVector);

  if (rotationGroups.length > 0) {
    const rotationVector = rotationVectorRaw ?? new Array(numberOfFrames).fill(1);
    // Running view-index counter per (detector, rotation) group, used when AngularViewVector is absent.
    const groupCounters = new Map<string, number>();

    // Some scanners populate DetectorInformationSequence.StartAngle with the shared gantry start
    // position rather than each head's true mounting angle. When all detectors have the same
    // StartAngle, these values carry no per-head information and the evenly-spaced fallback
    // (d × 360°/N) must be used instead; otherwise both heads receive identical angle sequences,
    // producing a 180°-rotated ghost of every structure in the FBP image.
    const definedDetectorStartAngles = Array.from(
      { length: numDetectors },
      (_, i) => detectorInfos[i]?.startAngleDeg,
    ).filter((a): a is number => a !== undefined);
    const detectorInfosEncodeHeadPositions =
      numDetectors < 2 ||
      definedDetectorStartAngles.length < numDetectors ||
      new Set(definedDetectorStartAngles.map((a) => Math.round(normalizeAngle(a)))).size > 1;

    console.log("[SPECT] rotationGroups:", JSON.stringify(rotationGroups));
    console.log("[SPECT] definedDetectorStartAngles:", definedDetectorStartAngles);
    console.log("[SPECT] detectorInfosEncodeHeadPositions:", detectorInfosEncodeHeadPositions);
    console.log("[SPECT] angularViewVector (first 20):", angularViewVectorRaw?.slice(0, 20));
    console.log("[SPECT] detectorVector (first 20):", detectorVector.slice(0, 20));

    const angles: number[] = new Array(numberOfFrames);
    for (let i = 0; i < numberOfFrames; i++) {
      const d = detectorVector[i];
      const rotationIndex1Based = rotationVector[i] ?? 1;
      const group = rotationGroups[rotationIndex1Based - 1] ?? rotationGroups[0];
      // Per-detector StartAngle from DetectorInformationSequence takes precedence — but only when
      // the values actually differ across heads (i.e., they encode head positions). If all entries
      // share the same angle, fall back to evenly-spaced offsets (d × 360°/N).
      const startAngleDeg = detectorInfosEncodeHeadPositions
        ? (detectorInfos[d]?.startAngleDeg ?? (group.startAngleDeg + d * (360 / numDetectors)))
        : group.startAngleDeg + d * (360 / numDetectors);
      let viewIndex: number;
      if (angularViewVectorRaw && angularViewVectorRaw[i] !== undefined) {
        viewIndex = angularViewVectorRaw[i] - 1;
      } else {
        const key = `${detectorVector[i]}:${rotationIndex1Based}`;
        viewIndex = groupCounters.get(key) ?? 0;
        groupCounters.set(key, viewIndex + 1);
      }
      angles[i] = normalizeAngle(startAngleDeg + group.directionSign * group.angularStepDeg * viewIndex);
    }
    console.log("[SPECT] computed angles (first 20):", angles.slice(0, 20).map((a) => +a.toFixed(1)));
    return angles;
  }

  // No rotation geometry at all: evenly space each detector's own frames over 360 degrees.
  const framesPerDetector = new Map<number, number>();
  for (const d of detectorVector) framesPerDetector.set(d, (framesPerDetector.get(d) ?? 0) + 1);
  const seenPerDetector = new Map<number, number>();
  const angles: number[] = new Array(numberOfFrames);
  for (let i = 0; i < numberOfFrames; i++) {
    const d = detectorVector[i];
    const total = framesPerDetector.get(d) ?? numberOfFrames;
    const seen = seenPerDetector.get(d) ?? 0;
    seenPerDetector.set(d, seen + 1);
    angles[i] = normalizeAngle(d * (360 / numDetectors) + (360 * seen) / total);
  }
  return angles;
}

/** Decodes one JPEG-Lossless-compressed frame (fragment bytes) into raw sample bytes. */
function decodeJpegLosslessFrame(fragment: Uint8Array): ArrayBuffer {
  const decoder = new JpegLosslessDecoder();
  return decoder.decompress(
    fragment.buffer as ArrayBuffer,
    fragment.byteOffset,
    fragment.length,
  ) as ArrayBuffer;
}

function readEncapsulatedPixelFrames(
  dataSet: DataSet,
  pixelDataElement: dicomParser.Element,
  numberOfFrames: number,
  pixelsPerFrame: number,
  bytesPerPixel: number,
  pixelRepresentation: number,
): Float32Array[] {
  const transferSyntax = dataSet.string(TAG.TransferSyntaxUID);
  if (!transferSyntax || !JPEG_LOSSLESS_TRANSFER_SYNTAXES.has(transferSyntax)) {
    throw new DicomParseError(
      `Komprimierte PixelData mit Transfer Syntax "${transferSyntax ?? "unbekannt"}" wird nicht unterstützt. ` +
        "Unterstützt werden unkomprimierte Dateien sowie JPEG Lossless " +
        "(1.2.840.10008.1.2.4.57 / 1.2.840.10008.1.2.4.70).",
    );
  }
  const basicOffsetTable =
    pixelDataElement.basicOffsetTable && pixelDataElement.basicOffsetTable.length > 0
      ? pixelDataElement.basicOffsetTable
      : dicomParser.createJPEGBasicOffsetTable(dataSet, pixelDataElement);

  const frames: Float32Array[] = [];
  for (let f = 0; f < numberOfFrames; f++) {
    const fragment = dicomParser.readEncapsulatedImageFrame(dataSet, pixelDataElement, f, basicOffsetTable);
    let decoded: ArrayBuffer;
    try {
      decoded = decodeJpegLosslessFrame(fragment);
    } catch (e) {
      throw new DicomParseError(`JPEG-Lossless-Dekodierung von Frame ${f} fehlgeschlagen: ${describeParseError(e)}`);
    }
    if (decoded.byteLength < pixelsPerFrame * bytesPerPixel) {
      throw new DicomParseError(
        `Dekodierter Frame ${f} ist zu kurz: erwartet ${pixelsPerFrame * bytesPerPixel} Bytes, ` +
          `gefunden ${decoded.byteLength}.`,
      );
    }
    const view = new DataView(decoded);
    const pixels = new Float32Array(pixelsPerFrame);
    for (let p = 0; p < pixelsPerFrame; p++) {
      const byteOffset = p * bytesPerPixel;
      let value: number;
      if (bytesPerPixel === 2) {
        value = pixelRepresentation === 1 ? view.getInt16(byteOffset, true) : view.getUint16(byteOffset, true);
      } else {
        value = pixelRepresentation === 1 ? view.getInt8(byteOffset) : view.getUint8(byteOffset);
      }
      pixels[p] = value;
    }
    frames.push(pixels);
  }
  return frames;
}

function readPixelFrames(
  dataSet: DataSet,
  byteArray: Uint8Array,
  numberOfFrames: number,
  rows: number,
  cols: number,
): Float32Array[] {
  const pixelDataElement = dataSet.elements[TAG.PixelData];
  if (!pixelDataElement) throw new DicomParseError("DICOM-Datei enthält keine PixelData (7FE0,0010).");
  const bitsAllocated = readNumeric(dataSet, TAG.BitsAllocated) ?? 16;
  const pixelRepresentation = readNumeric(dataSet, TAG.PixelRepresentation) ?? 0;
  const bytesPerPixel = bitsAllocated / 8;
  const pixelsPerFrame = rows * cols;

  if (pixelDataElement.encapsulatedPixelData) {
    return readEncapsulatedPixelFrames(
      dataSet,
      pixelDataElement,
      numberOfFrames,
      pixelsPerFrame,
      bytesPerPixel,
      pixelRepresentation,
    );
  }

  const frameByteLength = pixelsPerFrame * bytesPerPixel;
  const dataOffset = pixelDataElement.dataOffset;
  const available = pixelDataElement.length;
  if (frameByteLength * numberOfFrames > available) {
    throw new DicomParseError(
      `PixelData zu kurz für ${numberOfFrames} Frames à ${rows}x${cols} (${bitsAllocated} bit): ` +
        `erwartet ${frameByteLength * numberOfFrames} Bytes, gefunden ${available}.`,
    );
  }
  const view = new DataView(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
  const frames: Float32Array[] = [];
  for (let f = 0; f < numberOfFrames; f++) {
    const frameOffset = dataOffset + f * frameByteLength;
    const pixels = new Float32Array(pixelsPerFrame);
    for (let p = 0; p < pixelsPerFrame; p++) {
      const byteOffset = frameOffset + p * bytesPerPixel;
      let value: number;
      if (bytesPerPixel === 2) {
        value = pixelRepresentation === 1 ? view.getInt16(byteOffset, true) : view.getUint16(byteOffset, true);
      } else {
        value = pixelRepresentation === 1 ? view.getInt8(byteOffset) : view.getUint8(byteOffset);
      }
      pixels[p] = value;
    }
    frames.push(pixels);
  }
  return frames;
}

/** Parses a single NM (Nuclear Medicine) multi-frame DICOM file containing SPECT raw projections. */
export function parseSpectDicom(arrayBuffer: ArrayBuffer, fileName: string): SpectProjectionSet {
  const byteArray = new Uint8Array(arrayBuffer);
  let dataSet: DataSet;
  try {
    dataSet = dicomParser.parseDicom(byteArray, { vrCallback });
  } catch (e) {
    if (isMissingP10Prefix(e)) {
      // No 128-byte preamble / "DICM" magic: treat as a bare dataset in the most common
      // transfer syntax used for such exports (Explicit VR Little Endian).
      try {
        dataSet = dicomParser.parseDicom(byteArray, {
          vrCallback,
          TransferSyntaxUID: "1.2.840.10008.1.2.1",
        });
      } catch (e2) {
        throw new DicomParseError(`Konnte DICOM-Datei nicht parsen: ${describeParseError(e2)}`);
      }
    } else {
      throw new DicomParseError(`Konnte DICOM-Datei nicht parsen: ${describeParseError(e)}`);
    }
  }

  const modality = dataSet.string(TAG.Modality);
  if (modality && modality !== "NM") {
    throw new DicomParseError(`Erwartet Modality "NM" (Nuklearmedizin), gefunden "${modality}".`);
  }

  const rows = readNumeric(dataSet, TAG.Rows);
  const cols = readNumeric(dataSet, TAG.Columns);
  if (!rows || !cols) throw new DicomParseError("Rows/Columns fehlen in der DICOM-Datei.");

  const numberOfFrames = readNumeric(dataSet, TAG.NumberOfFrames) ?? 1;
  if (numberOfFrames < 2) {
    throw new DicomParseError(
      "Die Datei enthält nur einen Frame. Für eine SPECT-Rekonstruktion wird ein Multi-Frame-Datensatz " +
        "mit mehreren Projektionswinkeln benötigt.",
    );
  }

  const pixelSpacingRaw = readNumericArray(dataSet, TAG.PixelSpacing);
  const pixelSpacingMm: [number, number] =
    pixelSpacingRaw && pixelSpacingRaw.length >= 2 ? [pixelSpacingRaw[0], pixelSpacingRaw[1]] : [4.8, 4.8];

  const detectorVectorRaw = readNumericArray(dataSet, TAG.DetectorVector, numberOfFrames);
  const detectorVector: number[] =
    detectorVectorRaw && detectorVectorRaw.length === numberOfFrames
      ? detectorVectorRaw.map((d) => Math.max(0, d - 1))
      : new Array(numberOfFrames).fill(0);

  const numDetectors = Math.max(1, ...detectorVector.map((d) => d + 1));

  const detectorInfos = readDetectorInformationSequence(dataSet);
  const columnFlips = detectorColumnFlips(detectorInfos, numDetectors);

  const angles = computeFrameAngles(dataSet, numberOfFrames, detectorVector, detectorInfos, numDetectors);
  const pixelFrames = readPixelFrames(dataSet, byteArray, numberOfFrames, rows, cols);

  const frames: ProjectionFrame[] = pixelFrames.map((pixels, i) => ({
    detector: detectorVector[i],
    angleDeg: angles[i],
    pixels: columnFlips[detectorVector[i]] ? mirrorColumns(pixels, rows, cols) : pixels,
  }));

  return {
    rows,
    cols,
    pixelSpacingMm,
    numDetectors,
    frames,
    meta: {
      patientId: dataSet.string(TAG.PatientID),
      studyDate: dataSet.string(TAG.StudyDate),
      manufacturer: dataSet.string(TAG.Manufacturer),
      radionuclide: dataSet.string(TAG.Radionuclide),
      sourceFileName: fileName,
    },
  };
}

/**
 * Merges one or more parsed acquisitions into a single projection set. When more than one file
 * is supplied, each file is treated as one detector head's data (overriding any embedded
 * DetectorVector), covering vendors that export each head as a separate series.
 */
export function mergeProjectionSets(sets: SpectProjectionSet[]): SpectProjectionSet {
  if (sets.length === 0) throw new DicomParseError("Keine Dateien zum Zusammenführen übergeben.");
  const [first, ...rest] = sets;
  for (const s of rest) {
    if (s.rows !== first.rows || s.cols !== first.cols) {
      throw new DicomParseError(
        `Bildgrößen der hochgeladenen Dateien stimmen nicht überein (${first.rows}x${first.cols} vs. ${s.rows}x${s.cols}).`,
      );
    }
  }
  const multiFile = sets.length > 1;
  const frames = sets.flatMap((s, fileIndex) =>
    s.frames.map((f) => ({ ...f, detector: multiFile ? fileIndex : f.detector })),
  );
  const numDetectors = multiFile ? sets.length : first.numDetectors;
  return {
    rows: first.rows,
    cols: first.cols,
    pixelSpacingMm: first.pixelSpacingMm,
    numDetectors,
    frames,
    meta: { ...first.meta, sourceFileName: sets.map((s) => s.meta.sourceFileName).join(", ") },
  };
}

export { DicomParseError, decodeJpegLosslessFrame };
