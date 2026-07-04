/**
 * Tile sheet renderer: the scrollable left pane showing every tile in the
 * CHR buffer, 16 per row, with selection, dirty markers, and pattern-table
 * separators drawn on top.
 */
import { TILE_SIZE, getPixel, tileCount } from './chr';
import { PALETTES, state } from './state';

export const SHEET_COLS = 16;

/** Row a tile is displayed on. In pair mode, pairs stack even-over-odd. */
export function displayPos(tile: number, pairMode: boolean): { col: number; row: number } {
  if (!pairMode) {
    return { col: tile % SHEET_COLS, row: Math.floor(tile / SHEET_COLS) };
  }
  const pair = tile >> 1;
  return {
    col: pair % SHEET_COLS,
    row: Math.floor(pair / SHEET_COLS) * 2 + (tile & 1),
  };
}

/** Inverse of displayPos: which tile lives at a display cell. */
export function tileAtCell(col: number, row: number, pairMode: boolean): number {
  if (!pairMode) return row * SHEET_COLS + col;
  const pair = Math.floor(row / 2) * SHEET_COLS + col;
  return pair * 2 + (row & 1);
}

interface SheetCallbacks {
  onSelect(tile: number): void;
  onHover(tile: number | null): void;
}

export class SheetView {
  private ctx: CanvasRenderingContext2D;
  /** Unscaled 1×-pixel rendering of the sheet, also used for PNG export. */
  readonly backing: HTMLCanvasElement;

  constructor(
    private canvas: HTMLCanvasElement,
    callbacks: SheetCallbacks,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.backing = document.createElement('canvas');

    canvas.addEventListener('pointerdown', (e) => {
      const tile = this.tileFromEvent(e);
      if (tile !== null) callbacks.onSelect(tile);
    });
    canvas.addEventListener('pointermove', (e) => {
      callbacks.onHover(this.tileFromEvent(e));
    });
    canvas.addEventListener('pointerleave', () => callbacks.onHover(null));
  }

  private tileFromEvent(e: PointerEvent): number | null {
    if (!state.chr) return null;
    const rect = this.canvas.getBoundingClientRect();
    const cell = TILE_SIZE * state.zoom;
    const col = Math.floor((e.clientX - rect.left) / cell);
    const row = Math.floor((e.clientY - rect.top) / cell);
    if (col < 0 || col >= SHEET_COLS || row < 0) return null;
    const tile = tileAtCell(col, row, state.pairMode);
    return tile < state.tiles ? tile : null;
  }

  render(): void {
    const { canvas, ctx, backing } = this;
    if (!state.chr) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    const chr = state.chr;
    const tiles = tileCount(chr);
    const rows = Math.ceil(tiles / SHEET_COLS);
    const colors = PALETTES[state.paletteIndex].colors.map(hexToRgb);

    // 1× render into the backing canvas via ImageData.
    backing.width = SHEET_COLS * TILE_SIZE;
    backing.height = rows * TILE_SIZE;
    const bctx = backing.getContext('2d')!;
    const img = bctx.createImageData(backing.width, backing.height);
    for (let t = 0; t < tiles; t++) {
      const { col, row } = displayPos(t, state.pairMode);
      for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
          const [r, g, b] = colors[getPixel(chr, t, x, y)];
          const px = (row * TILE_SIZE + y) * backing.width + col * TILE_SIZE + x;
          img.data[px * 4] = r;
          img.data[px * 4 + 1] = g;
          img.data[px * 4 + 2] = b;
          img.data[px * 4 + 3] = 255;
        }
      }
    }
    bctx.putImageData(img, 0, 0);

    // Scale up to the display canvas.
    const zoom = state.zoom;
    canvas.width = backing.width * zoom;
    canvas.height = backing.height * zoom;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(backing, 0, 0, canvas.width, canvas.height);

    this.drawOverlays(rows);
  }

  private drawOverlays(rows: number): void {
    const { ctx } = this;
    const zoom = state.zoom;
    const cell = TILE_SIZE * zoom;
    const accent = '#d04a44';

    // Pattern-table separators: a red rule every 256 tiles (16 rows).
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1, Math.floor(zoom / 2));
    for (let r = 16; r < rows; r += 16) {
      ctx.beginPath();
      ctx.moveTo(0, r * cell + 0.5);
      ctx.lineTo(this.canvas.width, r * cell + 0.5);
      ctx.stroke();
    }

    // Label each 256-tile pattern table — the ids code refers to are
    // relative to these sections.
    if (rows > 16 && zoom >= 2) {
      ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'top';
      for (let pt = 0; pt * 16 < rows; pt++) {
        const label = `PT${pt}`;
        const y = pt * 16 * cell + 2;
        ctx.fillStyle = 'rgba(23, 24, 26, 0.75)';
        ctx.fillRect(1, y - 1, ctx.measureText(label).width + 6, 13);
        ctx.fillStyle = accent;
        ctx.fillText(label, 4, y);
      }
    }

    // Dirty-tile corner marks.
    ctx.fillStyle = accent;
    const mark = Math.max(3, zoom * 2);
    for (const t of state.dirty) {
      const { col, row } = displayPos(t, state.pairMode);
      const x = (col + 1) * cell;
      const y = row * cell;
      ctx.beginPath();
      ctx.moveTo(x - mark, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + mark);
      ctx.closePath();
      ctx.fill();
    }

    // Selection outline (covers the whole pair in pair mode).
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    for (const [i, t] of state.selectedTiles.entries()) {
      if (i > 0) continue; // outline drawn once, sized below
      const { col, row } = displayPos(t, state.pairMode);
      const h = state.selectedTiles.length * cell;
      ctx.strokeRect(col * cell + 1, row * cell + 1, cell - 2, h - 2);
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
