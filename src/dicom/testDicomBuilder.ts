/**
 * Minimal hand-rolled Explicit VR Little Endian DICOM dataset builder, used only by tests to
 * synthesize NM multi-frame files without depending on real patient data or a DICOM writer
 * library. Deliberately writes a "bare dataset" (no Part10 preamble/meta header) since
 * parseSpectDicom already falls back to Explicit VR Little Endian for such files.
 */

const LONG_VR = new Set(["OB", "OW", "OF", "SQ", "UT", "UN"]);

class DicomWriter {
  private bytes: number[] = [];

  private u16(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff);
  }

  private u32(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  }

  private raw(data: ArrayLike<number>) {
    for (let i = 0; i < data.length; i++) this.bytes.push(data[i]);
  }

  private ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.bytes.push(s.charCodeAt(i));
  }

  element(group: number, elem: number, vr: string, value: Uint8Array) {
    this.u16(group);
    this.u16(elem);
    this.ascii(vr);
    if (LONG_VR.has(vr)) {
      this.u16(0);
      this.u32(value.length);
    } else {
      this.u16(value.length);
    }
    this.raw(value);
  }

  item(content: Uint8Array) {
    this.u16(0xfffe);
    this.u16(0xe000);
    this.u32(content.length);
    this.raw(content);
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function str(s: string): Uint8Array {
  const padded = s.length % 2 === 0 ? s : s + " ";
  return Uint8Array.from(Array.from(padded).map((c) => c.charCodeAt(0)));
}

function usArray(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 2);
  const dv = new DataView(buf.buffer);
  values.forEach((v, i) => dv.setUint16(i * 2, v, true));
  return buf;
}

function us(value: number): Uint8Array {
  return usArray([value]);
}

function pixelData16(frames: number[][]): Uint8Array {
  const flat = frames.flat();
  const buf = new Uint8Array(flat.length * 2);
  const dv = new DataView(buf.buffer);
  flat.forEach((v, i) => dv.setUint16(i * 2, v, true));
  return buf;
}

export interface RotationGroupSpec {
  startAngleDeg: number;
  angularStepDeg: number;
  direction: "CW" | "CCW";
  framesInRotation: number;
}

export interface SyntheticDicomSpec {
  rows: number;
  cols: number;
  pixelSpacingMm: [number, number];
  /** 0-based detector index per frame. */
  detectorVector: number[];
  /** Pixel value to fill each frame with (frame index -> single uniform value), length = numFrames. */
  frameValues: number[];
  numDetectors: number;
  rotationGroups?: RotationGroupSpec[];
  /** 1-based rotation group index per frame (only used when rotationGroups is set). */
  rotationVector?: number[];
  /** 1-based view index per frame (only used when rotationGroups is set). */
  angularViewVector?: number[];
}

/** Builds a bare (no preamble) Explicit VR Little Endian NM multi-frame dataset for tests. */
export function buildSyntheticNmDicom(spec: SyntheticDicomSpec): ArrayBuffer {
  const w = new DicomWriter();
  const numFrames = spec.frameValues.length;

  w.element(0x0008, 0x0060, "CS", str("NM"));
  w.element(0x0028, 0x0010, "US", us(spec.rows));
  w.element(0x0028, 0x0011, "US", us(spec.cols));
  w.element(0x0028, 0x0008, "IS", str(String(numFrames)));
  w.element(0x0028, 0x0030, "DS", str(`${spec.pixelSpacingMm[0]}\\${spec.pixelSpacingMm[1]}`));
  w.element(0x0028, 0x0100, "US", us(16));
  w.element(0x0028, 0x0103, "US", us(0));
  w.element(0x0054, 0x0020, "US", usArray(spec.detectorVector.map((d) => d + 1)));
  w.element(0x0054, 0x0021, "US", us(spec.numDetectors));

  if (spec.rotationGroups && spec.rotationGroups.length > 0) {
    w.element(0x0054, 0x0050, "US", usArray(spec.rotationVector ?? spec.frameValues.map(() => 1)));
    if (spec.angularViewVector) {
      w.element(0x0054, 0x0090, "US", usArray(spec.angularViewVector));
    }
    const itemsWriter = new DicomWriter();
    for (const group of spec.rotationGroups) {
      const itemContent = new DicomWriter();
      itemContent.element(0x0054, 0x0200, "DS", str(String(group.startAngleDeg)));
      itemContent.element(0x0018, 0x1144, "DS", str(String(group.angularStepDeg)));
      itemContent.element(0x0018, 0x1140, "CS", str(group.direction));
      itemContent.element(0x0054, 0x0053, "US", us(group.framesInRotation));
      itemsWriter.item(itemContent.toUint8Array());
    }
    w.element(0x0054, 0x0052, "SQ", itemsWriter.toUint8Array());
  }

  const frames = spec.frameValues.map((v) => new Array(spec.rows * spec.cols).fill(v));
  w.element(0x7fe0, 0x0010, "OW", pixelData16(frames));

  return w.toUint8Array().buffer as ArrayBuffer;
}
