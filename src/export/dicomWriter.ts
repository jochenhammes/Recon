import type { Volume3D } from "../viewer/volume";
import { concatBytes, padToEven } from "./bytes";
import { generateUid } from "./uid";

/** Secondary Capture Image Storage, Multi-frame Grayscale Word: the standard minimal-compliance
 *  SOP class for exporting derived (non-modality-acquired) pixel data. */
const SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.7.2";
const TRANSFER_SYNTAX_EXPLICIT_VR_LE = "1.2.840.10008.1.2.1";
const IMPLEMENTATION_CLASS_UID = "2.25.211738491552672508525331571830986184675";
const IMPLEMENTATION_VERSION_NAME = "RECON_SPECT_01";

const LONG_VR = new Set(["OB", "OW", "OF", "SQ", "UT", "UN"]);

class ElementWriter {
  private chunks: Uint8Array[] = [];

  private push(bytes: Uint8Array) {
    this.chunks.push(bytes);
  }

  private u16le(v: number): Uint8Array {
    return Uint8Array.of(v & 0xff, (v >> 8) & 0xff);
  }

  private u32le(v: number): Uint8Array {
    return Uint8Array.of(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  }

  element(group: number, elem: number, vr: string, value: Uint8Array) {
    this.push(this.u16le(group));
    this.push(this.u16le(elem));
    this.push(new TextEncoder().encode(vr));
    if (LONG_VR.has(vr)) {
      this.push(this.u16le(0));
      this.push(this.u32le(value.length));
    } else {
      this.push(this.u16le(value.length));
    }
    this.push(value);
  }

  str(group: number, elem: number, vr: string, value: string, padChar = " ") {
    this.element(group, elem, vr, new TextEncoder().encode(padToEven(value, padChar)));
  }

  us(group: number, elem: number, value: number) {
    this.element(group, elem, "US", this.u16le(value));
  }

  ul(group: number, elem: number, value: number) {
    this.element(group, elem, "UL", this.u32le(value));
  }

  bytes(): Uint8Array {
    return concatBytes(this.chunks);
  }
}

export interface DicomExportMeta {
  studyDate?: string;
  seriesDescription: string;
}

/**
 * Builds a Part10 DICOM file (Secondary Capture, multi-frame 16-bit) from a reconstructed
 * Volume3D. The output is fully anonymized: no real patient identifiers are embedded, regardless
 * of what the original source projection data contained.
 */
export function buildReconstructionDicom(volume: Volume3D, meta: DicomExportMeta): Uint8Array<ArrayBuffer> {
  const { nx, ny, nz, data, voxelSpacingMm } = volume;
  const [spacingZ, spacingY, spacingX] = voxelSpacingMm;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max) || max <= min) max = min + 1;
  const slope = (max - min) / 65535;
  const intercept = min;

  const pixelData = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const q = Math.round((data[i] - intercept) / slope);
    pixelData[i] = Math.min(65535, Math.max(0, q));
  }
  const pixelBytes = new Uint8Array(pixelData.buffer, pixelData.byteOffset, pixelData.byteLength);

  const sopInstanceUid = generateUid();
  const studyInstanceUid = generateUid();
  const seriesInstanceUid = generateUid();

  const meta1 = new ElementWriter();
  meta1.element(0x0002, 0x0001, "OB", Uint8Array.of(0, 1)); // FileMetaInformationVersion
  meta1.str(0x0002, 0x0002, "UI", SOP_CLASS_UID, "\0");
  meta1.str(0x0002, 0x0003, "UI", sopInstanceUid, "\0");
  meta1.str(0x0002, 0x0010, "UI", TRANSFER_SYNTAX_EXPLICIT_VR_LE, "\0");
  meta1.str(0x0002, 0x0012, "UI", IMPLEMENTATION_CLASS_UID, "\0");
  meta1.str(0x0002, 0x0013, "SH", IMPLEMENTATION_VERSION_NAME);
  const metaBytes = meta1.bytes();

  const metaGroup = new ElementWriter();
  metaGroup.ul(0x0002, 0x0000, metaBytes.length);

  const ds = new ElementWriter();
  ds.str(0x0008, 0x0016, "UI", SOP_CLASS_UID, "\0");
  ds.str(0x0008, 0x0018, "UI", sopInstanceUid, "\0");
  ds.str(0x0008, 0x0060, "CS", "OT");
  if (meta.studyDate) ds.str(0x0008, 0x0020, "DA", meta.studyDate);
  ds.str(0x0008, 0x103e, "LO", meta.seriesDescription);
  ds.str(0x0010, 0x0010, "PN", "ANONYMIZED");
  ds.str(0x0010, 0x0020, "LO", "ANONYMIZED");
  ds.str(0x0020, 0x000d, "UI", studyInstanceUid, "\0");
  ds.str(0x0020, 0x000e, "UI", seriesInstanceUid, "\0");
  ds.str(0x0020, 0x0010, "SH", "1");
  ds.str(0x0020, 0x0011, "IS", "1");
  ds.str(0x0020, 0x0013, "IS", "1");
  ds.us(0x0028, 0x0002, 1); // SamplesPerPixel
  ds.str(0x0028, 0x0004, "CS", "MONOCHROME2");
  ds.str(0x0028, 0x0008, "IS", String(nz)); // NumberOfFrames
  ds.us(0x0028, 0x0010, ny); // Rows
  ds.us(0x0028, 0x0011, nx); // Columns
  ds.str(0x0028, 0x0030, "DS", `${spacingY}\\${spacingX}`); // PixelSpacing
  ds.str(0x0018, 0x0050, "DS", String(spacingZ)); // SliceThickness
  ds.us(0x0028, 0x0100, 16); // BitsAllocated
  ds.us(0x0028, 0x0101, 16); // BitsStored
  ds.us(0x0028, 0x0102, 15); // HighBit
  ds.us(0x0028, 0x0103, 0); // PixelRepresentation (unsigned)
  ds.str(0x0028, 0x1052, "DS", String(intercept)); // RescaleIntercept
  ds.str(0x0028, 0x1053, "DS", String(slope)); // RescaleSlope
  ds.element(0x7fe0, 0x0010, "OW", pixelBytes);

  const preamble = new Uint8Array(128);
  const magic = new TextEncoder().encode("DICM");

  return concatBytes([preamble, magic, metaGroup.bytes(), metaBytes, ds.bytes()]);
}
