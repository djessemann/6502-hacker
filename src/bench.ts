/**
 * Assembly bench: a small grid where tiles from the sheet are placed (with
 * per-placement flips) to reassemble a character the way the game composes
 * it. Purely visual — it never modifies CHR data — and it re-reads the
 * working buffer every render, so edits to a placed tile update live.
 */
import { TILE_SIZE, getPixel } from './chr';
import { BENCH_COLS, BENCH_ROWS, PALETTES, state } from './state';

const PX = 6; // canvas pixels per CHR pixel

export class BenchView {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => {
      if (!state.loaded) return;
      const rect = canvas.getBoundingClientRect();
      const col = Math.floor(((e.clientX - rect.left) / rect.width) * BENCH_COLS);
      const row = Math.floor(((e.clientY - rect.top) / rect.height) * BENCH_ROWS);
      if (col < 0 || col >= BENCH_COLS || row < 0 || row >= BENCH_ROWS) return;
      const idx = row * BENCH_COLS + col;
      state.benchSel = state.benchSel === idx ? null : idx;
      state.emit();
    });
  }

  render(): void {
    const { canvas, ctx } = this;
    const cell = TILE_SIZE * PX;
    canvas.width = BENCH_COLS * cell;
    canvas.height = BENCH_ROWS * cell;
    ctx.fillStyle = '#1c1e21';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!state.chr) return;

    const colors = PALETTES[state.paletteIndex].colors;
    for (let i = 0; i < state.bench.length; i++) {
      const placed = state.bench[i];
      const cx = (i % BENCH_COLS) * cell;
      const cy = Math.floor(i / BENCH_COLS) * cell;
      if (placed && placed.tile < state.tiles) {
        for (let y = 0; y < TILE_SIZE; y++) {
          for (let x = 0; x < TILE_SIZE; x++) {
            const sx = placed.flipH ? TILE_SIZE - 1 - x : x;
            const sy = placed.flipV ? TILE_SIZE - 1 - y : y;
            ctx.fillStyle = colors[getPixel(state.chr, placed.tile, sx, sy)];
            ctx.fillRect(cx + x * PX, cy + y * PX, PX, PX);
          }
        }
      }
    }

    // Cell grid.
    ctx.strokeStyle = 'rgba(233, 231, 226, 0.09)';
    ctx.lineWidth = 1;
    for (let c = 1; c < BENCH_COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cell + 0.5, 0);
      ctx.lineTo(c * cell + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let r = 1; r < BENCH_ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * cell + 0.5);
      ctx.lineTo(canvas.width, r * cell + 0.5);
      ctx.stroke();
    }

    // Armed cell.
    if (state.benchSel !== null) {
      const sx = (state.benchSel % BENCH_COLS) * cell;
      const sy = Math.floor(state.benchSel / BENCH_COLS) * cell;
      ctx.strokeStyle = '#d04a44';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, cell - 2, cell - 2);
    }
  }
}
