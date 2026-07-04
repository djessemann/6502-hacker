import { describe, expect, it } from 'vitest';
import {
  clearTile,
  decodeTile,
  encodeTile,
  flipTileH,
  flipTileV,
  getPixel,
  getTileBytes,
  setPixel,
  setTileBytes,
  tileCount,
} from './chr';

// Hand-computed fixture. Plane 0 (low bits) then plane 1 (high bits).
//
// Row 0: plane0 = 0b10000001, plane1 = 0b00000001
//   → pixel (0,0) = 1, pixels (1..6,0) = 0, pixel (7,0) = 1 | (1<<1) = 3
// Row 1: plane0 = 0b00000000, plane1 = 0b11111111
//   → every pixel in row 1 = 2
// Rows 2–7: all zero.
const FIXTURE = new Uint8Array([
  0b10000001,
  0b00000000,
  0,
  0,
  0,
  0,
  0,
  0, // plane 0
  0b00000001,
  0b11111111,
  0,
  0,
  0,
  0,
  0,
  0, // plane 1
]);

// The same tile as 64 row-major color indices.
const FIXTURE_PIXELS = new Uint8Array([
  1, 0, 0, 0, 0, 0, 0, 3, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

describe('getPixel', () => {
  it('reads hand-computed values from the fixture', () => {
    expect(getPixel(FIXTURE, 0, 0, 0)).toBe(1);
    expect(getPixel(FIXTURE, 0, 3, 0)).toBe(0);
    expect(getPixel(FIXTURE, 0, 7, 0)).toBe(3);
    for (let x = 0; x < 8; x++) expect(getPixel(FIXTURE, 0, x, 1)).toBe(2);
    expect(getPixel(FIXTURE, 0, 4, 5)).toBe(0);
  });

  it('addresses tiles beyond the first', () => {
    const chr = new Uint8Array(32);
    chr.set(FIXTURE, 16);
    expect(getPixel(chr, 1, 7, 0)).toBe(3);
    expect(getPixel(chr, 0, 7, 0)).toBe(0);
  });
});

describe('setPixel', () => {
  it('writes both planes with the same mask', () => {
    const chr = new Uint8Array(16);
    setPixel(chr, 0, 2, 4, 3);
    expect(chr[4]).toBe(0b00100000);
    expect(chr[12]).toBe(0b00100000);
    setPixel(chr, 0, 2, 4, 2);
    expect(chr[4]).toBe(0);
    expect(chr[12]).toBe(0b00100000);
    setPixel(chr, 0, 2, 4, 0);
    expect(chr[4]).toBe(0);
    expect(chr[12]).toBe(0);
  });

  it('round-trips every color through getPixel without disturbing neighbors', () => {
    const chr = FIXTURE.slice();
    for (const color of [0, 1, 2, 3]) {
      setPixel(chr, 0, 5, 6, color);
      expect(getPixel(chr, 0, 5, 6)).toBe(color);
    }
    // Neighbors untouched.
    expect(getPixel(chr, 0, 0, 0)).toBe(1);
    expect(getPixel(chr, 0, 7, 0)).toBe(3);
  });
});

describe('decodeTile / encodeTile', () => {
  it('decodes the fixture to hand-computed pixels', () => {
    expect(decodeTile(FIXTURE, 0)).toEqual(FIXTURE_PIXELS);
  });

  it('encodes hand-computed pixels back to the fixture bytes', () => {
    expect(encodeTile(FIXTURE_PIXELS)).toEqual(FIXTURE);
  });

  it('round-trips arbitrary data', () => {
    const chr = new Uint8Array(16);
    for (let i = 0; i < 16; i++) chr[i] = (i * 37 + 11) & 0xff;
    expect(encodeTile(decodeTile(chr, 0))).toEqual(chr);
  });
});

describe('flips and clear', () => {
  it('flipTileH mirrors pixels left-right', () => {
    const chr = FIXTURE.slice();
    flipTileH(chr, 0);
    expect(getPixel(chr, 0, 0, 0)).toBe(3);
    expect(getPixel(chr, 0, 7, 0)).toBe(1);
    for (let x = 0; x < 8; x++) expect(getPixel(chr, 0, x, 1)).toBe(2);
  });

  it('flipTileV mirrors pixels top-bottom', () => {
    const chr = FIXTURE.slice();
    flipTileV(chr, 0);
    expect(getPixel(chr, 0, 0, 7)).toBe(1);
    expect(getPixel(chr, 0, 7, 7)).toBe(3);
    for (let x = 0; x < 8; x++) expect(getPixel(chr, 0, x, 6)).toBe(2);
    expect(getPixel(chr, 0, 0, 0)).toBe(0);
  });

  it('double flips are identity', () => {
    const chr = FIXTURE.slice();
    flipTileH(chr, 0);
    flipTileH(chr, 0);
    expect(chr).toEqual(FIXTURE);
    flipTileV(chr, 0);
    flipTileV(chr, 0);
    expect(chr).toEqual(FIXTURE);
  });

  it('clearTile zeroes only the targeted tile', () => {
    const chr = new Uint8Array(48).fill(0xff);
    clearTile(chr, 1);
    expect(chr.slice(0, 16)).toEqual(new Uint8Array(16).fill(0xff));
    expect(chr.slice(16, 32)).toEqual(new Uint8Array(16));
    expect(chr.slice(32, 48)).toEqual(new Uint8Array(16).fill(0xff));
  });
});

describe('tile byte helpers', () => {
  it('getTileBytes returns an independent copy', () => {
    const chr = FIXTURE.slice();
    const bytes = getTileBytes(chr, 0);
    bytes[0] = 0;
    expect(chr[0]).toBe(FIXTURE[0]);
  });

  it('setTileBytes copies a tile to another slot', () => {
    const chr = new Uint8Array(32);
    chr.set(FIXTURE, 0);
    setTileBytes(chr, 1, getTileBytes(chr, 0));
    expect(getTileBytes(chr, 1)).toEqual(FIXTURE);
  });
});

describe('tileCount', () => {
  it('counts whole 16-byte tiles', () => {
    expect(tileCount(new Uint8Array(0))).toBe(0);
    expect(tileCount(new Uint8Array(16))).toBe(1);
    expect(tileCount(new Uint8Array(8192))).toBe(512);
  });
});
