import * as dicomParser from "dicom-parser";
import type { DataSet } from "dicom-parser";
import { Decoder as JpegLosslessDecoder } from "jpeg-lossless-decoder-js";

/** Transfer syntaxes whose encapsulated (compressed) PixelData can be decoded. */
export const JPEG_LOSSLESS_TRANSFER_SYNTAXES = new Set([
  "1.2.840.10008.1.2.4.57", // JPEG Lossless, Non-Hierarchical (Process 14)
  "1.2.840.10008.1.2.4.70", // JPEG Lossless, Non-Hierarchical, First-Order Prediction (Process 14 [Selection Value 1])
]);

export class PixelDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PixelDecodeError";
  }
}

export interface PixelLayout {
  numberOfFrames: number;
  rows: number;
  cols: number;
  bitsAllocated: number;
  /** 0 = unsigned, 1 = two's complement signed. */
  pixelRepresentation: number;
}

/**
 * dicom-parser throws plain strings or `{ exception, dataSet }` objects rather than Error
 * instances, so `String(e)` on those yields "[object Object]". Extracts a readable message.
 */
export function describeParseError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "exception" in e && typeof e.exception === "string") return e.exception;
  return String(e);
}

/** Decodes one JPEG-Lossless-compressed frame (fragment bytes) into raw sample bytes. */
export function decodeJpegLosslessFrame(fragment: Uint8Array): ArrayBuffer {
  const decoder = new JpegLosslessDecoder();
  return decoder.decompress(
    fragment.buffer as ArrayBuffer,
    fragment.byteOffset,
    fragment.length,
  ) as ArrayBuffer;
}

/**
 * Decodes the stored (raw, pre-rescale) pixel values of every frame. Supports uncompressed
 * little-endian PixelData and JPEG Lossless encapsulated PixelData, 8/16/32-bit integer samples.
 */
export function decodePixelFrames(dataSet: DataSet, layout: PixelLayout): Float32Array[] {
  const pixelDataElement = dataSet.elements["x7fe00010"];
  if (!pixelDataElement) throw new PixelDecodeError("DICOM-Datei enthält keine PixelData (7FE0,0010).");
  const { numberOfFrames, rows, cols, bitsAllocated, pixelRepresentation } = layout;
  if (bitsAllocated !== 8 && bitsAllocated !== 16 && bitsAllocated !== 32) {
    throw new PixelDecodeError(`${bitsAllocated}-bit-Pixel werden nicht unterstützt.`);
  }
  const bytesPerPixel = bitsAllocated / 8;
  const pixelsPerFrame = rows * cols;

  if (pixelDataElement.encapsulatedPixelData) {
    return decodeEncapsulatedFrames(dataSet, pixelDataElement, numberOfFrames, pixelsPerFrame, bytesPerPixel, pixelRepresentation);
  }

  const frameByteLength = pixelsPerFrame * bytesPerPixel;
  if (frameByteLength * numberOfFrames > pixelDataElement.length) {
    throw new PixelDecodeError(
      `PixelData zu kurz für ${numberOfFrames} Frames à ${rows}x${cols} (${bitsAllocated} bit): ` +
        `erwartet ${frameByteLength * numberOfFrames} Bytes, gefunden ${pixelDataElement.length}.`,
    );
  }
  const byteArray = dataSet.byteArray;
  const view = new DataView(byteArray.buffer, byteArray.byteOffset, byteArray.byteLength);
  const frames: Float32Array[] = [];
  for (let f = 0; f < numberOfFrames; f++) {
    frames.push(readSamples(view, pixelDataElement.dataOffset + f * frameByteLength, pixelsPerFrame, bytesPerPixel, pixelRepresentation));
  }
  return frames;
}

function readSamples(view: DataView, offset: number, count: number, bytesPerPixel: number, pixelRepresentation: number): Float32Array {
  const out = new Float32Array(count);
  const signed = pixelRepresentation === 1;
  for (let p = 0; p < count; p++) {
    const o = offset + p * bytesPerPixel;
    if (bytesPerPixel === 2) out[p] = signed ? view.getInt16(o, true) : view.getUint16(o, true);
    else if (bytesPerPixel === 1) out[p] = signed ? view.getInt8(o) : view.getUint8(o);
    else out[p] = signed ? view.getInt32(o, true) : view.getUint32(o, true);
  }
  return out;
}

function decodeEncapsulatedFrames(
  dataSet: DataSet,
  pixelDataElement: dicomParser.Element,
  numberOfFrames: number,
  pixelsPerFrame: number,
  bytesPerPixel: number,
  pixelRepresentation: number,
): Float32Array[] {
  const transferSyntax = dataSet.string("x00020010");
  if (!transferSyntax || !JPEG_LOSSLESS_TRANSFER_SYNTAXES.has(transferSyntax)) {
    throw new PixelDecodeError(
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
      throw new PixelDecodeError(`JPEG-Lossless-Dekodierung von Frame ${f} fehlgeschlagen: ${describeParseError(e)}`);
    }
    if (decoded.byteLength < pixelsPerFrame * bytesPerPixel) {
      throw new PixelDecodeError(
        `Dekodierter Frame ${f} ist zu kurz: erwartet ${pixelsPerFrame * bytesPerPixel} Bytes, ` +
          `gefunden ${decoded.byteLength}.`,
      );
    }
    frames.push(readSamples(new DataView(decoded), 0, pixelsPerFrame, bytesPerPixel, pixelRepresentation));
  }
  return frames;
}
