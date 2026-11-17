/** Minimal ZIP reader (stored and deflate entries, no ZIP64/encryption) for user-supplied archives. */

export interface UnzippedEntry {
  /** Path inside the archive ("/" separated). */
  name: string;
  size: number;
  /** Decompresses the entry. */
  read: () => Promise<Uint8Array<ArrayBuffer>>;
}

export class ZipError extends Error {}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function listZip(buffer: ArrayBuffer): UnzippedEntry[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // End of central directory: signature 0x06054b50 within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new ZipError("Keine ZIP-Datei (Verzeichnis nicht gefunden).");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: UnzippedEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new ZipError("Beschädigtes ZIP-Verzeichnis.");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const read = async () => {
      if (view.getUint32(local, true) !== 0x04034b50) throw new ZipError(`Beschädigter Eintrag ${name}.`);
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.slice(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new ZipError(`Kompressionsverfahren ${method} wird nicht unterstützt (${name}).`);
    };
    entries.push({ name, size, read });
  }
  return entries;
}
