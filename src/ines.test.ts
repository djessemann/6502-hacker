import { describe, expect, it } from 'vitest';
import { RomError, extractChr, hasInesMagic, parseRom, patchRom } from './ines';

const MAGIC = [0x4e, 0x45, 0x53, 0x1a];

interface RomOptions {
  prgUnits?: number;
  chrUnits?: number;
  flags6?: number;
  flags7?: number;
  byte9?: number;
  trainer?: boolean;
  /** Extra bytes to truncate from the end of the file. */
  truncate?: number;
}

/** Build a tiny synthetic ROM with recognizable PRG/CHR fill bytes. */
function makeRom({
  prgUnits = 1,
  chrUnits = 1,
  flags6 = 0,
  flags7 = 0,
  byte9 = 0,
  trainer = false,
  truncate = 0,
}: RomOptions = {}): Uint8Array {
  const header = new Uint8Array(16);
  header.set(MAGIC, 0);
  header[4] = prgUnits;
  header[5] = chrUnits;
  header[6] = flags6 | (trainer ? 0x04 : 0);
  header[7] = flags7;
  header[9] = byte9;
  const trainerBytes = trainer ? 512 : 0;
  const prgSize = prgUnits * 16384;
  const chrSize = chrUnits * 8192;
  const rom = new Uint8Array(16 + trainerBytes + prgSize + chrSize - truncate);
  rom.set(header, 0);
  rom.fill(0xaa, 16, 16 + trainerBytes); // trainer marker
  rom.fill(0xbb, 16 + trainerBytes, Math.min(rom.length, 16 + trainerBytes + prgSize)); // PRG
  if (rom.length > 16 + trainerBytes + prgSize) {
    rom.fill(0xcc, 16 + trainerBytes + prgSize); // CHR marker
  }
  return rom;
}

describe('parseRom — iNES', () => {
  it('parses a plain header without trainer', () => {
    const info = parseRom(makeRom({ prgUnits: 2, chrUnits: 1 }));
    expect(info.kind).toBe('ines');
    expect(info.prgSize).toBe(32768);
    expect(info.chrSize).toBe(8192);
    expect(info.hasTrainer).toBe(false);
    expect(info.chrOffset).toBe(16 + 32768);
  });

  it('accounts for a 512-byte trainer', () => {
    const info = parseRom(makeRom({ prgUnits: 1, chrUnits: 1, trainer: true }));
    expect(info.hasTrainer).toBe(true);
    expect(info.chrOffset).toBe(16 + 512 + 16384);
  });

  it('detects CHR-RAM (CHR size 0) and refuses to edit', () => {
    expect(() => parseRom(makeRom({ chrUnits: 0 }))).toThrowError(RomError);
    expect(() => parseRom(makeRom({ chrUnits: 0 }))).toThrowError(/CHR-RAM/);
  });

  it('rejects a file whose CHR section runs past the end', () => {
    expect(() => parseRom(makeRom({ truncate: 100 }))).toThrowError(/only .* bytes/);
  });
});

describe('parseRom — NES 2.0', () => {
  it('detects NES 2.0 via (byte7 & 0x0C) === 0x08', () => {
    const info = parseRom(makeRom({ flags7: 0x08 }));
    expect(info.kind).toBe('nes2');
  });

  it('applies byte 9 high nibble as the CHR size extension', () => {
    // chrUnits = (0x1 << 8) | 2 = 258 units → 258 × 8192 bytes.
    const chrUnits = 0x102;
    const rom = makeRom({ prgUnits: 1, chrUnits: 0 /* placeholder */, flags7: 0x08 });
    // Rebuild with the real CHR payload since makeRom sizes from chrUnits ≤ 255.
    const full = new Uint8Array(16 + 16384 + chrUnits * 8192);
    full.set(rom.subarray(0, 16), 0);
    full[5] = chrUnits & 0xff;
    full[9] = (chrUnits >> 8) << 4;
    const info = parseRom(full);
    expect(info.kind).toBe('nes2');
    expect(info.chrSize).toBe(chrUnits * 8192);
    expect(info.chrOffset).toBe(16 + 16384);
  });

  it('applies byte 9 low nibble to PRG size (affects CHR offset)', () => {
    // prgUnits = (0x1 << 8) | 0 = 256 units → 4 MiB PRG.
    const prgSize = 256 * 16384;
    const full = new Uint8Array(16 + prgSize + 8192);
    full.set(MAGIC, 0);
    full[4] = 0;
    full[5] = 1;
    full[7] = 0x08;
    full[9] = 0x01;
    const info = parseRom(full);
    expect(info.prgSize).toBe(prgSize);
    expect(info.chrOffset).toBe(16 + prgSize);
  });

  it('uses exponent-multiplier encoding when the size nibble is 0xF', () => {
    // lsb = EEEEEEMM: exponent 13, multiplier 1 → 2^13 × 3 = 24576 bytes.
    const lsb = (13 << 2) | 1;
    const chrSize = 2 ** 13 * 3;
    const full = new Uint8Array(16 + 16384 + chrSize);
    full.set(MAGIC, 0);
    full[4] = 1;
    full[5] = lsb;
    full[7] = 0x08;
    full[9] = 0xf0;
    const info = parseRom(full);
    expect(info.chrSize).toBe(chrSize);
  });
});

describe('parseRom — raw .chr fallback', () => {
  it('loads magic-less data with length a multiple of 16', () => {
    const info = parseRom(new Uint8Array(64));
    expect(info.kind).toBe('raw');
    expect(info.chrOffset).toBe(0);
    expect(info.chrSize).toBe(64);
  });

  it('rejects magic-less data that is not a multiple of 16', () => {
    expect(() => parseRom(new Uint8Array(65))).toThrowError(RomError);
    expect(() => parseRom(new Uint8Array(0))).toThrowError(RomError);
  });
});

describe('hasInesMagic', () => {
  it('matches only the exact 4-byte magic', () => {
    expect(hasInesMagic(makeRom())).toBe(true);
    expect(hasInesMagic(new Uint8Array([0x4e, 0x45, 0x53, 0x00]))).toBe(false);
    expect(hasInesMagic(new Uint8Array(2))).toBe(false);
  });
});

describe('extractChr / patchRom', () => {
  it('extracts exactly the CHR section', () => {
    const rom = makeRom({ prgUnits: 1, chrUnits: 1, trainer: true });
    const info = parseRom(rom);
    const chr = extractChr(rom, info);
    expect(chr.length).toBe(8192);
    expect(chr.every((b) => b === 0xcc)).toBe(true);
  });

  it('patches CHR back at the same offset without touching header, trainer, or PRG', () => {
    const rom = makeRom({ prgUnits: 1, chrUnits: 1, trainer: true });
    const info = parseRom(rom);
    const chr = extractChr(rom, info);
    chr.fill(0xdd);
    const patched = patchRom(rom, info, chr);

    expect(patched.length).toBe(rom.length);
    expect(patched.subarray(0, 16)).toEqual(rom.subarray(0, 16)); // header
    expect(patched.subarray(16, 16 + 512).every((b) => b === 0xaa)).toBe(true); // trainer
    expect(patched.subarray(528, 528 + 16384).every((b) => b === 0xbb)).toBe(true); // PRG
    expect(patched.subarray(info.chrOffset).every((b) => b === 0xdd)).toBe(true); // new CHR
    // Original untouched.
    expect(rom.subarray(info.chrOffset).every((b) => b === 0xcc)).toBe(true);
  });

  it('rejects a CHR buffer of the wrong size', () => {
    const rom = makeRom();
    const info = parseRom(rom);
    expect(() => patchRom(rom, info, new Uint8Array(4096))).toThrowError(RomError);
  });
});
