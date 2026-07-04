/**
 * NES 2bpp planar tile codec — pure functions over Uint8Array CHR data.
 *
 * Each tile is 16 bytes = 8×8 pixels at 2 bits per pixel.
 * Bytes 0–7 hold bitplane 0 (low bit of each pixel), bytes 8–15 hold
 * bitplane 1 (high bit). Within a plane byte, bit 7 is the leftmost pixel.
 */

export const TILE_BYTES = 16;
export const TILE_SIZE = 8;

/** Number of whole tiles in a CHR buffer. */
export function tileCount(chr: Uint8Array): number {
  return Math.floor(chr.length / TILE_BYTES);
}

/** Read the 2-bit color index of pixel (x, y) in tile `tile`. */
export function getPixel(chr: Uint8Array, tile: number, x: number, y: number): number {
  const bit = 7 - x;
  const base = tile * TILE_BYTES;
  const lo = (chr[base + y] >> bit) & 1;
  const hi = (chr[base + 8 + y] >> bit) & 1;
  return lo | (hi << 1);
}

/** Write a 2-bit color index to pixel (x, y) in tile `tile`, updating both planes. */
export function setPixel(chr: Uint8Array, tile: number, x: number, y: number, color: number): void {
  const mask = 1 << (7 - x);
  const base = tile * TILE_BYTES;
  if (color & 1) chr[base + y] |= mask;
  else chr[base + y] &= ~mask;
  if (color & 2) chr[base + 8 + y] |= mask;
  else chr[base + 8 + y] &= ~mask;
}

/** Decode a tile into 64 color indices, row-major. */
export function decodeTile(chr: Uint8Array, tile: number): Uint8Array {
  const out = new Uint8Array(TILE_SIZE * TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      out[y * TILE_SIZE + x] = getPixel(chr, tile, x, y);
    }
  }
  return out;
}

/** Encode 64 row-major color indices into 16 planar bytes. */
export function encodeTile(pixels: Uint8Array): Uint8Array {
  const out = new Uint8Array(TILE_BYTES);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const color = pixels[y * TILE_SIZE + x] & 3;
      const mask = 1 << (7 - x);
      if (color & 1) out[y] |= mask;
      if (color & 2) out[y + 8] |= mask;
    }
  }
  return out;
}

/** Copy of the raw 16 bytes of a tile. */
export function getTileBytes(chr: Uint8Array, tile: number): Uint8Array {
  return chr.slice(tile * TILE_BYTES, (tile + 1) * TILE_BYTES);
}

/** Overwrite a tile's 16 bytes. */
export function setTileBytes(chr: Uint8Array, tile: number, bytes: Uint8Array): void {
  chr.set(bytes.subarray(0, TILE_BYTES), tile * TILE_BYTES);
}

/** Mirror a tile left↔right in place. */
export function flipTileH(chr: Uint8Array, tile: number): void {
  const base = tile * TILE_BYTES;
  for (let i = 0; i < TILE_BYTES; i++) {
    chr[base + i] = reverseByte(chr[base + i]);
  }
}

/** Mirror a tile top↔bottom in place. */
export function flipTileV(chr: Uint8Array, tile: number): void {
  const base = tile * TILE_BYTES;
  for (const planeStart of [0, 8]) {
    for (let y = 0; y < 4; y++) {
      const a = base + planeStart + y;
      const b = base + planeStart + 7 - y;
      const tmp = chr[a];
      chr[a] = chr[b];
      chr[b] = tmp;
    }
  }
}

/** Zero out a tile (all pixels to color 0). */
export function clearTile(chr: Uint8Array, tile: number): void {
  chr.fill(0, tile * TILE_BYTES, (tile + 1) * TILE_BYTES);
}

function reverseByte(b: number): number {
  b = ((b & 0xf0) >> 4) | ((b & 0x0f) << 4);
  b = ((b & 0xcc) >> 2) | ((b & 0x33) << 2);
  b = ((b & 0xaa) >> 1) | ((b & 0x55) << 1);
  return b;
}
