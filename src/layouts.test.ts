import { describe, expect, it } from 'vitest';
import { parseLayouts, parseTileRef, spriteBounds, tileAtPoint } from './layouts';

describe('parseTileRef', () => {
  it('accepts numbers, decimal strings, and hex strings', () => {
    expect(parseTileRef(58)).toBe(58);
    expect(parseTileRef('58')).toBe(58);
    expect(parseTileRef('$3A')).toBe(0x3a);
    expect(parseTileRef('0x3A')).toBe(0x3a);
  });

  it('rejects garbage', () => {
    expect(parseTileRef(-1)).toBeNull();
    expect(parseTileRef(1.5)).toBeNull();
    expect(parseTileRef('$xyz')).toBeNull();
    expect(parseTileRef(null)).toBeNull();
    expect(parseTileRef({})).toBeNull();
  });
});

describe('parseLayouts', () => {
  const good = JSON.stringify({
    sprites: [
      {
        name: 'hero',
        tiles: [
          { tile: '$04', x: 0, y: 0 },
          { tile: 5, x: 8, y: 0, flipH: true },
        ],
      },
    ],
  });

  it('parses a valid document with defaults applied', () => {
    const sprites = parseLayouts(good, 512);
    expect(sprites).toHaveLength(1);
    expect(sprites[0].name).toBe('hero');
    expect(sprites[0].tiles[0]).toEqual({ tile: 4, x: 0, y: 0, flipH: false, flipV: false });
    expect(sprites[0].tiles[1].flipH).toBe(true);
  });

  it('accepts a bare array of sprites', () => {
    const sprites = parseLayouts(JSON.stringify([{ tiles: [{ tile: 0, x: 0, y: 0 }] }]), 16);
    expect(sprites[0].name).toBe('sprite 1');
  });

  it('applies the optional per-sprite pattern table offset', () => {
    const doc = JSON.stringify({
      sprites: [{ pt: 1, tiles: [{ tile: '$0A', x: 0, y: 0 }] }],
    });
    expect(parseLayouts(doc, 512)[0].tiles[0].tile).toBe(256 + 0x0a);
  });

  it('reports every problem with sprite and entry labels', () => {
    const doc = JSON.stringify({
      sprites: [
        { name: 'ok', tiles: [{ tile: 0, x: 0, y: 0 }] },
        {
          name: 'bad',
          tiles: [
            { tile: '$FFF', x: 0, y: 0 },
            { tile: 1, x: 'left', y: 0 },
          ],
        },
      ],
    });
    expect(() => parseLayouts(doc, 512)).toThrowError(/sprite 2 \(bad\), entry 1/);
    expect(() => parseLayouts(doc, 512)).toThrowError(/entry 2: "x" and "y"/);
  });

  it('rejects invalid JSON and empty documents', () => {
    expect(() => parseLayouts('{nope', 512)).toThrowError(/Not valid JSON/);
    expect(() => parseLayouts('{"sprites": []}', 512)).toThrowError(/at least one sprite/);
    expect(() => parseLayouts('{}', 512)).toThrowError(/at least one sprite/);
  });

  it('rejects tiles outside the loaded sheet', () => {
    expect(() => parseLayouts(good, 5)).toThrowError(/outside this sheet/);
  });
});

describe('geometry', () => {
  const sprite = {
    name: 's',
    tiles: [
      { tile: 1, x: 0, y: 0, flipH: false, flipV: false },
      { tile: 2, x: 8, y: 0, flipH: false, flipV: false },
      { tile: 3, x: 4, y: 4, flipH: false, flipV: false }, // overlaps both, drawn on top
    ],
  };

  it('computes bounds including negative origins', () => {
    expect(spriteBounds(sprite)).toEqual({ x: 0, y: 0, w: 16, h: 12 });
    const neg = { name: 'n', tiles: [{ tile: 0, x: -8, y: -1, flipH: false, flipV: false }] };
    expect(spriteBounds(neg)).toEqual({ x: -8, y: -1, w: 8, h: 8 });
  });

  it('hit-tests back-to-front so overlapping tiles pick the visible one', () => {
    expect(tileAtPoint(sprite, 6, 6)).toBe(3); // overlap region → topmost
    expect(tileAtPoint(sprite, 1, 1)).toBe(1);
    expect(tileAtPoint(sprite, 15, 1)).toBe(2);
    expect(tileAtPoint(sprite, 30, 30)).toBeNull();
  });
});
