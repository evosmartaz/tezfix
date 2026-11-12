// Types for heic-decode 2.x (libheif compiled to WebAssembly; the package ships no typings).
declare module 'heic-decode' {
  interface DecodedHeic {
    width: number;
    height: number;
    /** RGBA, 4 bytes per pixel, image transforms (rotation/mirror) applied. */
    data: Uint8ClampedArray;
  }
  function decode(input: { buffer: Buffer | Uint8Array | ArrayBuffer }): Promise<DecodedHeic>;
  export = decode;
}
