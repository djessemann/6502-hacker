/**
 * Metasprite layout parsing and geometry — pure functions.
 *
 * The accepted JSON describes how a game composes CHR tiles into
 * characters. It is intentionally lenient (hex or decimal tile refs,
 * optional flips, optional per-sprite pattern table) because the usual
 * author is an AI assistant extracting layouts from game code.
 */
import { TILE_SIZE } from './chr';

export interface LayoutTile {
  /** Global sheet index (pattern table × 256 + in-table id). */
  tile: number;
  x: number;
  y: number;
  flipH: boolean;
  flipV: boolean;
}

export interface LayoutSprite {
  name: string;
  tiles: LayoutTile[];
}

const MAX_SPRITES = 64;
const MAX_TILES = 128;
const MIN_COORD = -64;
const MAX_COORD = 512;

/** Accepts 0x3A / "$3A" / "0x3A" / "58"-style refs; null when unparsable. */
export function parseTileRef(v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isInteger(v) && v >= 0 ? v : null;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    const m = /^(\$|0x)?([0-9a-fA-F]+)$/.exec(s);
    if (!m) return null;
    return parseInt(m[2], m[1] ? 16 : 10);
  }
  return null;
}

/**
 * Parse layout JSON against the currently loaded sheet. Throws an Error
 * whose message lists every problem found, one per line.
 */
export function parseLayouts(text: string, tileCount: number): LayoutSprite[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Not valid JSON: ${err instanceof Error ? err.message : err}`);
  }

  const raw = Array.isArray(data) ? data : (data as { sprites?: unknown })?.sprites;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Expected { "sprites": [ … ] } with at least one sprite.');
  }
  if (raw.length > MAX_SPRITES) {
    throw new Error(`Too many sprites (${raw.length}); the gallery caps at ${MAX_SPRITES}.`);
  }

  const errors: string[] = [];
  const sprites: LayoutSprite[] = [];

  raw.forEach((s, i) => {
    const obj = (s ?? {}) as Record<string, unknown>;
    const name =
      typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : `sprite ${i + 1}`;
    const label = `sprite ${i + 1} (${name})`;

    const pt = obj.pt === undefined ? 0 : obj.pt;
    if (typeof pt !== 'number' || !Number.isInteger(pt) || pt < 0) {
      errors.push(`${label}: "pt" must be a non-negative integer pattern table number`);
      return;
    }

    if (!Array.isArray(obj.tiles) || obj.tiles.length === 0) {
      errors.push(`${label}: needs a non-empty "tiles" array`);
      return;
    }
    if (obj.tiles.length > MAX_TILES) {
      errors.push(`${label}: ${obj.tiles.length} tiles is over the ${MAX_TILES} cap`);
      return;
    }

    const tiles: LayoutTile[] = [];
    obj.tiles.forEach((t, j) => {
      const e = (t ?? {}) as Record<string, unknown>;
      const where = `${label}, entry ${j + 1}`;
      const ref = parseTileRef(e.tile);
      if (ref === null) {
        errors.push(`${where}: "tile" must be a number or "$hex" string`);
        return;
      }
      const tile = pt * 256 + ref;
      if (tile >= tileCount) {
        errors.push(
          `${where}: tile $${tile.toString(16).toUpperCase()} is outside this sheet (${tileCount} tiles)`,
        );
        return;
      }
      const x = typeof e.x === 'number' && Number.isFinite(e.x) ? e.x : NaN;
      const y = typeof e.y === 'number' && Number.isFinite(e.y) ? e.y : NaN;
      if (Number.isNaN(x) || Number.isNaN(y)) {
        errors.push(`${where}: "x" and "y" must be numbers (pixel offsets)`);
        return;
      }
      if (x < MIN_COORD || x > MAX_COORD || y < MIN_COORD || y > MAX_COORD) {
        errors.push(`${where}: position (${x}, ${y}) is outside ${MIN_COORD}…${MAX_COORD}`);
        return;
      }
      tiles.push({ tile, x, y, flipH: e.flipH === true, flipV: e.flipV === true });
    });

    if (tiles.length === obj.tiles.length) sprites.push({ name, tiles });
  });

  if (errors.length > 0) throw new Error(errors.join('\n'));
  return sprites;
}

/** Bounding box of a sprite's tiles in its own coordinate space. */
export function spriteBounds(s: LayoutSprite): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of s.tiles) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + TILE_SIZE);
    maxY = Math.max(maxY, t.y + TILE_SIZE);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Which tile is under point (px, py) in sprite coordinates? Later entries
 * draw on top, so search back-to-front.
 */
export function tileAtPoint(s: LayoutSprite, px: number, py: number): number | null {
  for (let i = s.tiles.length - 1; i >= 0; i--) {
    const t = s.tiles[i];
    if (px >= t.x && px < t.x + TILE_SIZE && py >= t.y && py < t.y + TILE_SIZE) {
      return t.tile;
    }
  }
  return null;
}
