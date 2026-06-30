// jpeg-lossless-decoder-js ships no type declarations (its package.json points at a
// release/lossless.d.ts that isn't actually published). Minimal surface used here.
declare module "jpeg-lossless-decoder-js" {
  export class Decoder {
    constructor(buffer?: ArrayBuffer | null, numBytes?: number);
    decompress(buffer: ArrayBuffer, offset?: number, length?: number): ArrayBuffer;
  }
}
