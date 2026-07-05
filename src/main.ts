/**
 * App wiring: file I/O, toolbar, keyboard, status bar, exports.
 * All state lives in memory (src/state.ts) — nothing is persisted.
 */
import './style.css';
import { clearTile, flipTileH, flipTileV, getTileBytes, setTileBytes, TILE_BYTES } from './chr';
import { extractChr, parseRom, patchRom, RomError } from './ines';
import { EditorView } from './editor';
import { SheetView } from './sheet';
import { PALETTES, state } from './state';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const fileInput = $<HTMLInputElement>('#file-input');
const fileMeta = $('#file-meta');
const btnDlNes = $<HTMLButtonElement>('#btn-dl-nes');
const btnDlChr = $<HTMLButtonElement>('#btn-dl-chr');
const btnDlPng = $<HTMLButtonElement>('#btn-dl-png');
const zoomLabel = $('#zoom-label');
const pairToggle = $<HTMLInputElement>('#pair-toggle');
const paletteSelect = $<HTMLSelectElement>('#palette-select');
const emptyState = $('#empty-state');
const dropOverlay = $('#drop-overlay');
const statusSelected = $('#status-selected');
const statusHover = $('#status-hover');
const statusDirty = $('#status-dirty');
const statusWarn = $('#status-warn');
const toolPaste = $<HTMLButtonElement>('#tool-paste');
const toolUndo = $<HTMLButtonElement>('#tool-undo');
const toolRedo = $<HTMLButtonElement>('#tool-redo');
const toolBrush = $<HTMLButtonElement>('#tool-brush');
const toolFill = $<HTMLButtonElement>('#tool-fill');
const toolPick = $<HTMLButtonElement>('#tool-pick');
const btnNotes = $<HTMLButtonElement>('#btn-notes');
const helpDialog = $<HTMLDialogElement>('#help-dialog');

const sheet = new SheetView($<HTMLCanvasElement>('#sheet-canvas'), {
  onSelect: (tile) => state.select(tile),
  onHover: (tile) => {
    state.hoverTile = tile;
    renderStatus();
  },
});
const editor = new EditorView($<HTMLCanvasElement>('#editor-canvas'));

// ── Formatting helpers ─────────────────────────────────────

function hexTile(t: number): string {
  return '$' + t.toString(16).toUpperCase().padStart(2, '0');
}

function hex(n: number): string {
  return '0x' + n.toString(16).toUpperCase();
}

function kib(bytes: number): string {
  return bytes % 1024 === 0 ? `${bytes / 1024} KiB` : `${bytes} B`;
}

/**
 * Where a tile lives, in the terms ROM-hacking code uses: pattern table
 * number, id within that table, and absolute file offset.
 */
function tileLocation(t: number): { pt: number; ptId: number; fileOffset: number } {
  const info = state.romInfo!;
  return { pt: t >> 8, ptId: t & 0xff, fileOffset: info.chrOffset + t * 16 };
}

// ── File loading ───────────────────────────────────────────

async function loadFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const info = parseRom(bytes);
    state.loadRom(file.name, bytes, info, extractChr(bytes, info));
    statusWarn.textContent = '';
  } catch (err) {
    statusWarn.textContent = err instanceof RomError ? err.message : `Failed to load: ${err}`;
    renderStatus();
  }
}

$('#btn-load').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
  fileInput.value = '';
});

// Drag-and-drop anywhere on the page.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (e.dataTransfer?.types.includes('Files')) {
    dragDepth++;
    dropOverlay.hidden = false;
  }
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    dropOverlay.hidden = true;
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  const file = e.dataTransfer?.files[0];
  if (file) void loadFile(file);
});

// Warn before losing unsaved edits.
window.addEventListener('beforeunload', (e) => {
  if (state.dirty.size > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ── Exports ────────────────────────────────────────────────

function baseName(): string {
  return (state.fileName ?? 'chr').replace(/\.[^.]+$/, '') + '-edited';
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

btnDlNes.addEventListener('click', () => {
  if (!state.fileBytes || !state.romInfo || !state.chr || state.romInfo.kind === 'raw') return;
  const patched = patchRom(state.fileBytes, state.romInfo, state.chr);
  download(new Blob([patched.slice().buffer]), `${baseName()}.nes`);
});

btnDlChr.addEventListener('click', () => {
  if (!state.chr) return;
  download(new Blob([state.chr.slice().buffer]), `${baseName()}.chr`);
});

btnDlPng.addEventListener('click', () => {
  if (!state.chr) return;
  const scale = 4;
  const out = document.createElement('canvas');
  out.width = sheet.backing.width * scale;
  out.height = sheet.backing.height * scale;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet.backing, 0, 0, out.width, out.height);
  out.toBlob((blob) => {
    if (blob) download(blob, `${baseName()}.png`);
  }, 'image/png');
});

// ── Sheet toolbar ──────────────────────────────────────────

$('#zoom-in').addEventListener('click', () => setZoom(state.zoom + 1));
$('#zoom-out').addEventListener('click', () => setZoom(state.zoom - 1));

function setZoom(z: number): void {
  state.zoom = Math.max(1, Math.min(6, z));
  state.emit();
}

pairToggle.addEventListener('change', () => {
  state.pairMode = pairToggle.checked;
  state.select(state.selected); // snaps to even in pair mode
});

// ── Palette ────────────────────────────────────────────────

for (const [i, p] of PALETTES.entries()) {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = p.name;
  paletteSelect.append(opt);
}
paletteSelect.addEventListener('change', () => {
  state.paletteIndex = Number(paletteSelect.value);
  state.emit();
});

const swatches = Array.from(document.querySelectorAll<HTMLButtonElement>('.swatch'));
for (const swatch of swatches) {
  swatch.addEventListener('click', () => {
    state.colorSlot = Number(swatch.dataset.slot);
    state.emit();
  });
}

// ── Tools ──────────────────────────────────────────────────

$('#tool-flip-h').addEventListener('click', () => {
  const tiles = state.selectedTiles;
  if (!tiles.length) return;
  state.edit(tiles, (chr) => {
    for (const t of tiles) flipTileH(chr, t);
  });
});

$('#tool-flip-v').addEventListener('click', () => {
  const tiles = state.selectedTiles;
  if (!tiles.length) return;
  state.edit(tiles, (chr) => {
    if (tiles.length === 2) {
      // Flip the 8×16 unit as a whole: swap the tiles, then flip each.
      const top = getTileBytes(chr, tiles[0]);
      setTileBytes(chr, tiles[0], getTileBytes(chr, tiles[1]));
      setTileBytes(chr, tiles[1], top);
    }
    for (const t of tiles) flipTileV(chr, t);
  });
});

$('#tool-clear').addEventListener('click', () => {
  const tiles = state.selectedTiles;
  if (!tiles.length) return;
  state.edit(tiles, (chr) => {
    for (const t of tiles) clearTile(chr, t);
  });
});

$('#tool-copy').addEventListener('click', () => {
  if (!state.chr) return;
  const tiles = state.selectedTiles;
  const buf = new Uint8Array(tiles.length * TILE_BYTES);
  tiles.forEach((t, i) => buf.set(getTileBytes(state.chr!, t), i * TILE_BYTES));
  state.clipboard = buf;
  state.emit();
});

toolPaste.addEventListener('click', () => {
  if (!state.chr || !state.clipboard) return;
  const clip = state.clipboard;
  const start = state.selectedTiles[0];
  const count = Math.min(clip.length / TILE_BYTES, state.tiles - start);
  const targets = Array.from({ length: count }, (_, i) => start + i);
  state.edit(targets, (chr) => {
    targets.forEach((t, i) => setTileBytes(chr, t, clip.subarray(i * TILE_BYTES)));
  });
});

toolUndo.addEventListener('click', () => state.undo());
toolRedo.addEventListener('click', () => state.redo());

function setTool(tool: 'brush' | 'fill' | 'pick'): void {
  state.tool = tool;
  state.emit();
}
toolBrush.addEventListener('click', () => setTool('brush'));
toolFill.addEventListener('click', () => setTool('fill'));
toolPick.addEventListener('click', () => setTool('pick'));

// ── Help & hack notes ──────────────────────────────────────

$('#btn-help').addEventListener('click', () => {
  // <dialog> is missing on older WebKit; fall back to the open attribute.
  if (typeof helpDialog.showModal === 'function') helpDialog.showModal();
  else helpDialog.setAttribute('open', '');
  // showModal focuses the Close button at the bottom; start at the top.
  helpDialog.scrollTop = 0;
});

/**
 * Markdown summary of every edited tile, written for pasting into an AI
 * coding assistant (or a forum post): ROM identity plus each tile's
 * pattern-table id and file offset.
 */
function hackNotes(): string {
  const info = state.romInfo!;
  const kindLabel = { ines: 'iNES', nes2: 'NES 2.0', raw: 'raw CHR' }[info.kind];
  const edited = [...state.dirty].sort((a, b) => a - b);
  const lines = [
    `# CHR edits — ${state.fileName}`,
    '',
    info.kind === 'raw'
      ? `- File: ${state.fileName} (raw CHR dump, ${info.chrSize} bytes)`
      : `- ROM: ${state.fileName} (${kindLabel}, mapper ${info.mapper}, PRG ${kib(info.prgSize)}, CHR ${kib(info.chrSize)})`,
    `- CHR section: file offset ${hex(info.chrOffset)}, ${state.tiles} tiles`,
    `- Edited tiles: ${edited.length} (edited file saved as ${baseName()}.${info.kind === 'raw' ? 'chr' : 'nes'})`,
    '',
    '| tile | pattern table | id in table | file offset |',
    '| --- | --- | --- | --- |',
    ...edited.map((t) => {
      const { pt, ptId, fileOffset } = tileLocation(t);
      return `| ${hexTile(t)} | PT${pt} | ${hexTile(ptId)} | ${hex(fileOffset)} |`;
    }),
    '',
    'Each tile is 16 bytes of 2bpp planar data (bitplane 0 in bytes 0–7, bitplane 1 in bytes 8–15).',
    'The edited file above already contains these art changes; use the ids/offsets to find related',
    'code — sprite/OAM tile ids, nametable entries, palette assignments.',
  ];
  return lines.join('\n');
}

btnNotes.addEventListener('click', async () => {
  if (!state.loaded || state.dirty.size === 0) return;
  try {
    await navigator.clipboard.writeText(hackNotes());
    flashStatus('Notes copied');
  } catch {
    flashStatus('Clipboard unavailable — check browser permissions');
  }
});

let flashTimer: ReturnType<typeof setTimeout> | undefined;
function flashStatus(msg: string): void {
  const el = $('#status-msg');
  el.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    el.textContent = '';
  }, 4000);
}

// ── Keyboard ───────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.matches('input, select, textarea')) return;

  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) state.redo();
    else state.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    state.redo();
    return;
  }
  if (mod) return;

  switch (e.key) {
    case '1':
    case '2':
    case '3':
    case '4':
      state.colorSlot = Number(e.key) - 1;
      state.emit();
      break;
    case 'b':
    case 'B':
      setTool('brush');
      break;
    case 'f':
    case 'F':
      setTool('fill');
      break;
    case 'i':
    case 'I':
      setTool('pick');
      break;
    case '[':
      state.select(state.selected - (state.pairMode ? 2 : 1));
      break;
    case ']':
      state.select(state.selected + (state.pairMode ? 2 : 1));
      break;
    case 'ArrowUp':
      e.preventDefault();
      editor.moveCursor(0, -1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      editor.moveCursor(0, 1);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      editor.moveCursor(-1, 0);
      break;
    case 'ArrowRight':
      e.preventDefault();
      editor.moveCursor(1, 0);
      break;
    case ' ':
    case 'Enter':
      if (state.loaded) {
        e.preventDefault();
        state.edit(state.selectedTiles, () => {
          editor.paintAt(state.cursor.x, state.cursor.y);
        });
      }
      break;
  }
});

// ── Rendering ──────────────────────────────────────────────

function renderStatus(): void {
  if (!state.loaded) {
    statusSelected.textContent = 'no file';
    statusHover.textContent = '';
    statusDirty.textContent = '';
    return;
  }
  const sel = state.selectedTiles;
  const loc = tileLocation(state.selected);
  const multiTable = state.tiles > 256;
  const where = `${multiTable ? `PT${loc.pt} ${hexTile(loc.ptId)} · ` : ''}file ${hex(loc.fileOffset)}`;
  statusSelected.textContent =
    sel.length === 2
      ? `pair ${hexTile(sel[0])}+${hexTile(sel[1])} · ${where}`
      : `tile ${hexTile(state.selected)} · ${where}`;
  if (state.hoverTile !== null) {
    const h = tileLocation(state.hoverTile);
    statusHover.textContent = `hover ${hexTile(state.hoverTile)}${multiTable ? ` (PT${h.pt} ${hexTile(h.ptId)})` : ''}`;
  } else {
    statusHover.textContent = '';
  }
  statusDirty.textContent =
    state.dirty.size > 0
      ? `${state.dirty.size} tile${state.dirty.size === 1 ? '' : 's'} edited`
      : '';
}

function renderMeta(): void {
  if (!state.romInfo) {
    fileMeta.textContent = '';
    return;
  }
  const kindLabel = { ines: 'iNES', nes2: 'NES 2.0', raw: 'raw CHR' }[state.romInfo.kind];
  const parts = [
    `<strong>${escapeHtml(state.fileName ?? '')}</strong>`,
    kindLabel,
    state.romInfo.mapper !== null ? `mapper ${state.romInfo.mapper}` : '',
    state.romInfo.kind !== 'raw' ? `PRG ${kib(state.romInfo.prgSize)}` : '',
    `CHR ${kib(state.romInfo.chrSize)}`,
    `${state.tiles} tiles`,
    state.romInfo.hasTrainer ? 'trainer' : '',
  ].filter(Boolean);
  fileMeta.innerHTML = parts.join(' · ');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render(): void {
  emptyState.style.display = state.loaded ? 'none' : '';
  zoomLabel.textContent = `${state.zoom}×`;

  const palette = PALETTES[state.paletteIndex];
  for (const swatch of swatches) {
    const slot = Number(swatch.dataset.slot);
    swatch.style.background = palette.colors[slot];
    swatch.setAttribute('aria-pressed', String(slot === state.colorSlot));
  }

  btnDlNes.disabled = !state.loaded || state.romInfo?.kind === 'raw';
  btnDlChr.disabled = !state.loaded;
  btnDlPng.disabled = !state.loaded;
  btnNotes.disabled = !state.loaded || state.dirty.size === 0;
  toolPaste.disabled = !state.loaded || !state.clipboard;
  toolUndo.disabled = !state.canUndo;
  toolRedo.disabled = !state.canRedo;
  toolBrush.setAttribute('aria-pressed', String(state.tool === 'brush'));
  toolFill.setAttribute('aria-pressed', String(state.tool === 'fill'));
  toolPick.setAttribute('aria-pressed', String(state.tool === 'pick'));
  for (const id of ['#tool-flip-h', '#tool-flip-v', '#tool-clear', '#tool-copy']) {
    $<HTMLButtonElement>(id).disabled = !state.loaded;
  }

  renderMeta();
  renderStatus();
  sheet.render();
  editor.render();
}

state.subscribe(render);
render();
