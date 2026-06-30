/** Shared low-level byte-buffer helpers for the DICOM and NIfTI writers. */

export function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function asciiBytes(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** Pads a string to even byte length using the given pad character (default space). */
export function padToEven(s: string, padChar = " "): string {
  return s.length % 2 === 0 ? s : s + padChar;
}
