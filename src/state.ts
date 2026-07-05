/**
 * In-memory application state with a tiny pub/sub and tile-level undo.
 * Nothing is ever persisted — no localStorage, no sessionStorage.
 */
import { TILE_BYTES, getTileBytes, setTileBytes, tileCount } from './chr';
import type { RomInfo } from './ines';

export interface PalettePreset {
  name: string;
  colors: [string, string, string, string];
}

/**
 * Preview palettes. Grayscale is the honest view of the 2bpp indices;
 * the rest are NES master-palette picks for previewing tiles in
 * plausible game colors. Purely cosmetic — saved data is always indices.
 */
export const PALETTES: PalettePreset[] = [
  { name: 'Grayscale', colors: ['#000000', '#666666', '#aaaaaa', '#ffffff'] },
  { name: 'Hero ($0F $16 $27 $36)', colors: ['#000000', '#b53120', '#efb133', '#feccc5'] },
  { name: 'Overworld ($0F $1A $2A $37)', colors: ['#000000', '#33871b', '#7cda1c', '#fee067'] },
  { name: 'Cave ($0F $01 $21 $31)', colors: ['#000000', '#0d2ba0', '#4fcdde', '#a6e3fa'] },
  { name: 'Dusk ($0F $04 $24 $34)', colors: ['#000000', '#7b1191', '#eb7cf6', '#f9c3fb'] },
];

interface TileDelta {
  index: number;
  before: Uint8Array;
  after: Uint8Array;
}

/**
 * One placed tile on the assembly bench. The same shape will describe a
 * metasprite entry when layout import lands.
 */
export interface BenchCell {
  tile: number;
  flipH: boolean;
  flipV: boolean;
}

export const BENCH_COLS = 4;
export const BENCH_ROWS = 4;

const UNDO_LIMIT = 200;

type Listener = () => void;

class AppState {
  fileName: string | null = null;
  /** Original file bytes, untouched — the patch base. */
  fileBytes: Uint8Array | null = null;
  romInfo: RomInfo | null = null;
  /**
   * Tile-aligned window into the working buffer. In CHR-ROM games this is
   * the whole buffer; in CHR-RAM games it starts `viewOffset` bytes in so
   * misaligned graphics can be brought into register.
   */
  chr: Uint8Array | null = null;
  /** Matching window into the pristine copy, for dirty-tile tracking. */
  originalChr: Uint8Array | null = null;
  /** Full working buffer (edits land here through the `chr` view). */
  private workFull: Uint8Array | null = null;
  private origFull: Uint8Array | null = null;
  viewOffset = 0;

  selected = 0;
  colorSlot = 3;
  tool: 'brush' | 'fill' | 'pick' = 'brush';
  pairMode = false;
  zoom = 3;
  paletteIndex = 0;
  cursor = { x: 0, y: 0 };
  hoverTile: number | null = null;
  dirty = new Set<number>();
  clipboard: Uint8Array | null = null;
  bench: (BenchCell | null)[] = new Array<BenchCell | null>(BENCH_COLS * BENCH_ROWS).fill(null);
  /** Bench cell armed to receive the next sheet click, or null. */
  benchSel: number | null = null;

  private undoStack: TileDelta[][] = [];
  private redoStack: TileDelta[][] = [];
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): void {
    this.listeners.add(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  get loaded(): boolean {
    return this.chr !== null;
  }

  get tiles(): number {
    return this.chr ? tileCount(this.chr) : 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Tiles the editor currently operates on: one tile, or an even/odd pair. */
  get selectedTiles(): number[] {
    if (!this.loaded) return [];
    if (!this.pairMode) return [this.selected];
    const even = this.selected & ~1;
    return even + 1 < this.tiles ? [even, even + 1] : [even];
  }

  /** Full working buffer — the thing to splice back into the ROM. */
  get chrFull(): Uint8Array | null {
    return this.workFull;
  }

  loadRom(name: string, bytes: Uint8Array, info: RomInfo, chr: Uint8Array): void {
    this.fileName = name;
    this.fileBytes = bytes;
    this.romInfo = info;
    this.workFull = chr;
    this.origFull = chr.slice();
    this.viewOffset = 0;
    this.applyView();
    this.selected = 0;
    this.cursor = { x: 0, y: 0 };
    this.hoverTile = null;
    this.dirty.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.bench.fill(null);
    this.benchSel = null;
    this.emit();
  }

  /** Recompute the tile-aligned views for the current viewOffset. */
  private applyView(): void {
    if (!this.workFull || !this.origFull) return;
    const off = this.viewOffset;
    const usable = Math.floor((this.workFull.length - off) / TILE_BYTES) * TILE_BYTES;
    this.chr = this.workFull.subarray(off, off + usable);
    this.originalChr = this.origFull.subarray(off, off + usable);
  }

  /**
   * Shift the decode window by 0–15 bytes (CHR-RAM mode). Tile indices
   * change meaning, so undo history and the bench are reset and the
   * dirty set is rescanned against the pristine copy.
   */
  setViewOffset(off: number): void {
    if (!this.workFull) return;
    this.viewOffset = ((off % TILE_BYTES) + TILE_BYTES) % TILE_BYTES;
    this.applyView();
    this.undoStack = [];
    this.redoStack = [];
    this.bench.fill(null);
    this.benchSel = null;
    this.selected = Math.max(0, Math.min(this.tiles - 1, this.selected));
    this.dirty.clear();
    for (let t = 0; t < this.tiles; t++) this.refreshDirty(t);
    this.emit();
  }

  select(tile: number): void {
    if (!this.loaded) return;
    let t = Math.max(0, Math.min(this.tiles - 1, tile));
    if (this.pairMode) t &= ~1; // selection snaps to even indices in pair mode
    this.selected = t;
    this.emit();
  }

  /** Re-check a tile against the pristine copy and update the dirty set. */
  refreshDirty(tile: number): void {
    if (!this.chr || !this.originalChr) return;
    const base = tile * TILE_BYTES;
    let same = true;
    for (let i = 0; i < TILE_BYTES; i++) {
      if (this.chr[base + i] !== this.originalChr[base + i]) {
        same = false;
        break;
      }
    }
    if (same) this.dirty.delete(tile);
    else this.dirty.add(tile);
  }

  /** Snapshot `tiles` before an edit. Each tile is captured once per stroke. */
  beginEdit(tiles: number[]): TileDelta[] {
    if (!this.chr) return [];
    return tiles.map((index) => ({
      index,
      before: getTileBytes(this.chr!, index),
      after: new Uint8Array(0),
    }));
  }

  /** Finish an edit: record afters and push an undo entry if anything changed. */
  commitEdit(deltas: TileDelta[]): void {
    if (!this.chr) return;
    const changed = deltas.filter((d) => {
      d.after = getTileBytes(this.chr!, d.index);
      return !bytesEqual(d.before, d.after);
    });
    if (changed.length === 0) return;
    this.undoStack.push(changed);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.emit();
  }

  /** Run `fn` against the CHR buffer with undo capture around it. */
  edit(tiles: number[], fn: (chr: Uint8Array) => void): void {
    if (!this.chr) return;
    const deltas = this.beginEdit(tiles);
    fn(this.chr);
    for (const t of tiles) this.refreshDirty(t);
    this.commitEdit(deltas);
    this.emit();
  }

  undo(): void {
    this.applyStep(this.undoStack, this.redoStack, 'before');
  }

  redo(): void {
    this.applyStep(this.redoStack, this.undoStack, 'after');
  }

  private applyStep(from: TileDelta[][], to: TileDelta[][], which: 'before' | 'after'): void {
    const entry = from.pop();
    if (!entry || !this.chr) return;
    for (const d of entry) {
      setTileBytes(this.chr, d.index, which === 'before' ? d.before : d.after);
      this.refreshDirty(d.index);
    }
    to.push(entry);
    this.emit();
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export const state = new AppState();
