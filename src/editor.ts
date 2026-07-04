/**
 * Pixel editor: the large zoomed canvas on the right. Paints with
 * click-drag using pointer capture; shows an 8×16 unit in pair mode with
 * a red divider between the two tiles. Also owns the keyboard cursor.
 */
import { TILE_SIZE, fillTiles, getPixel, setPixel } from './chr';
import { PALETTES, state } from './state';

const PX = 28; // canvas pixels per CHR pixel

interface TileDelta {
  index: number;
  before: Uint8Array;
  after: Uint8Array;
}

export class EditorView {
  private ctx: CanvasRenderingContext2D;
  private stroke: TileDelta[] | null = null;
  private painting = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;

    // Right-click is the eyedropper, so never show the context menu here.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('pointerdown', (e) => {
      if (!state.loaded) return;
      const cell = this.cellFromEvent(e);
      if (!cell) return;
      state.cursor = cell;

      // Eyedropper: right-click or Alt+click picks up the color under the pointer.
      if (e.button === 2 || e.altKey) {
        const tiles = state.selectedTiles;
        state.colorSlot = getPixel(
          state.chr!,
          tiles[Math.floor(cell.y / TILE_SIZE)],
          cell.x,
          cell.y % TILE_SIZE,
        );
        state.emit();
        return;
      }
      if (e.button !== 0) return;

      if (state.tool === 'fill') {
        const tiles = state.selectedTiles;
        state.edit(tiles, (chr) => fillTiles(chr, tiles, cell.x, cell.y, state.colorSlot));
        return;
      }

      canvas.setPointerCapture(e.pointerId);
      this.painting = true;
      // Snapshot each affected tile once per stroke.
      this.stroke = state.beginEdit(state.selectedTiles);
      this.paintFromEvent(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.painting) this.paintFromEvent(e);
    });
    const finish = () => {
      if (!this.painting) return;
      this.painting = false;
      if (this.stroke) state.commitEdit(this.stroke);
      this.stroke = null;
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
  }

  /** Editor height in CHR pixels: 8, or 16 in pair mode. */
  private get rows(): number {
    return state.selectedTiles.length * TILE_SIZE;
  }

  private cellFromEvent(e: PointerEvent): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * TILE_SIZE);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * this.rows);
    if (x < 0 || x >= TILE_SIZE || y < 0 || y >= this.rows) return null;
    return { x, y };
  }

  private paintFromEvent(e: PointerEvent): void {
    const cell = this.cellFromEvent(e);
    if (!cell) return;
    state.cursor = cell;
    this.paintAt(cell.x, cell.y);
  }

  /** Paint the current color slot at editor coordinates (y may reach 15 in pair mode). */
  paintAt(x: number, y: number): void {
    if (!state.chr) return;
    const tiles = state.selectedTiles;
    const tile = tiles[Math.floor(y / TILE_SIZE)];
    setPixel(state.chr, tile, x, y % TILE_SIZE, state.colorSlot);
    state.refreshDirty(tile);
    state.emit();
  }

  /** Move the keyboard cursor, clamped to the visible unit. */
  moveCursor(dx: number, dy: number): void {
    state.cursor = {
      x: Math.max(0, Math.min(TILE_SIZE - 1, state.cursor.x + dx)),
      y: Math.max(0, Math.min(this.rows - 1, state.cursor.y + dy)),
    };
    state.emit();
  }

  render(): void {
    const { canvas, ctx } = this;
    if (!state.chr) {
      canvas.width = TILE_SIZE * PX;
      canvas.height = TILE_SIZE * PX;
      ctx.fillStyle = '#1c1e21';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const tiles = state.selectedTiles;
    const rows = this.rows;
    canvas.width = TILE_SIZE * PX;
    canvas.height = rows * PX;
    const colors = PALETTES[state.paletteIndex].colors;

    for (const [i, tile] of tiles.entries()) {
      for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
          ctx.fillStyle = colors[getPixel(state.chr, tile, x, y)];
          ctx.fillRect(x * PX, (i * TILE_SIZE + y) * PX, PX, PX);
        }
      }
    }

    // Faint grid lines.
    ctx.strokeStyle = 'rgba(233, 231, 226, 0.09)';
    ctx.lineWidth = 1;
    for (let x = 1; x < TILE_SIZE; x++) {
      ctx.beginPath();
      ctx.moveTo(x * PX + 0.5, 0);
      ctx.lineTo(x * PX + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 1; y < rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * PX + 0.5);
      ctx.lineTo(canvas.width, y * PX + 0.5);
      ctx.stroke();
    }

    // Red divider between the two halves of an 8×16 pair.
    if (tiles.length === 2) {
      ctx.strokeStyle = '#d04a44';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, TILE_SIZE * PX);
      ctx.lineTo(canvas.width, TILE_SIZE * PX);
      ctx.stroke();
    }

    // Keyboard cursor.
    const cy = Math.min(state.cursor.y, rows - 1);
    ctx.strokeStyle = '#d04a44';
    ctx.lineWidth = 2;
    ctx.strokeRect(state.cursor.x * PX + 1.5, cy * PX + 1.5, PX - 3, PX - 3);
  }
}
