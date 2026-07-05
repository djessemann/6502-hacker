/**
 * Layout gallery: renders imported metasprite layouts as small canvases,
 * live from the working CHR buffer, and maps clicks on a rendered sprite
 * back to the tile under the pointer.
 */
import { TILE_SIZE, getPixel } from './chr';
import { spriteBounds, tileAtPoint } from './layouts';
import type { LayoutSprite } from './layouts';
import { PALETTES, state } from './state';

const PX = 3; // canvas pixels per CHR pixel

export class LayoutGallery {
  private builtRev = -1;
  private canvases: HTMLCanvasElement[] = [];

  constructor(
    private container: HTMLElement,
    private onPick: (tile: number) => void,
  ) {}

  render(): void {
    if (state.layoutsRev !== this.builtRev) this.rebuild();
    for (const [i, sprite] of state.layouts.entries()) this.draw(sprite, this.canvases[i]);
  }

  /** Recreate the cards when the layout list itself changes. */
  private rebuild(): void {
    this.builtRev = state.layoutsRev;
    this.container.textContent = '';
    this.canvases = [];
    for (const sprite of state.layouts) {
      const card = document.createElement('div');
      card.className = 'layout-card';
      const canvas = document.createElement('canvas');
      const b = spriteBounds(sprite);
      canvas.width = b.w * PX;
      canvas.height = b.h * PX;
      canvas.title = `${sprite.name} — click a tile to edit it`;
      canvas.addEventListener('pointerdown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const sx = ((e.clientX - rect.left) / rect.width) * b.w + b.x;
        const sy = ((e.clientY - rect.top) / rect.height) * b.h + b.y;
        const tile = tileAtPoint(sprite, sx, sy);
        if (tile !== null) this.onPick(tile);
      });
      const label = document.createElement('span');
      label.textContent = sprite.name;
      card.append(canvas, label);
      this.container.append(card);
      this.canvases.push(canvas);
    }
  }

  private draw(sprite: LayoutSprite, canvas: HTMLCanvasElement): void {
    if (!state.chr || !canvas) return;
    const ctx = canvas.getContext('2d')!;
    const b = spriteBounds(sprite);
    const colors = PALETTES[state.paletteIndex].colors;
    ctx.fillStyle = '#1c1e21';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const t of sprite.tiles) {
      if (t.tile >= state.tiles) continue;
      for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
          const sx = t.flipH ? TILE_SIZE - 1 - x : x;
          const sy = t.flipV ? TILE_SIZE - 1 - y : y;
          const color = getPixel(state.chr, t.tile, sx, sy);
          if (color === 0) continue; // slot 0 is transparent for sprites
          ctx.fillStyle = colors[color];
          ctx.fillRect((t.x - b.x + x) * PX, (t.y - b.y + y) * PX, PX, PX);
        }
      }
    }
  }
}
