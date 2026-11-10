// Test-only rasterising and image comparison: SVG to PNG with resvg (WebAssembly build, so
// every platform produces the same pixels), a small PNG decoder, and a pixel diff.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const require = createRequire(import.meta.url);

let ready: Promise<void> | undefined;

/** Loads the resvg WebAssembly module once. */
export function initRaster(): Promise<void> {
  ready ??= initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
  return ready;
}

export interface Image {
  readonly width: number;
  readonly height: number;
  /** RGBA, 8 bits per channel, rows top to bottom. */
  readonly pixels: Uint8Array;
}

/** Renders an SVG at its own size (call initRaster first). */
export function rasterize(svg: string): Image & { readonly png: Uint8Array } {
  const resvg = new Resvg(svg, { font: { loadSystemFonts: false }, shapeRendering: 2 });
  const img = resvg.render();
  const out = {
    width: img.width,
    height: img.height,
    pixels: img.pixels.slice(),
    png: img.asPng(),
  };
  img.free();
  resvg.free();
  return out;
}

// --- PNG ---------------------------------------------------------------------------------

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Decodes an 8-bit RGBA or RGB, non-interlaced PNG (what resvg writes). */
export function decodePng(bytes: Uint8Array): Image {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!SIGNATURE.every((b, i) => bytes[i] === b)) throw new Error('Not a PNG file.');
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  for (let p = 8; p < bytes.length;) {
    const length = view.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const data = bytes.subarray(p + 8, p + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(p + 8);
      height = view.getUint32(p + 12);
      const depth = data[8];
      const color = data[9];
      const interlace = data[12];
      if (depth !== 8 || (color !== 6 && color !== 2) || interlace !== 0) {
        throw new Error('Only 8-bit RGB(A), non-interlaced PNGs are supported.');
      }
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (rows[dst + x - channels] ?? 0) : 0;
      const b = y > 0 ? (rows[dst - stride + x] ?? 0) : 0;
      const c = x >= channels && y > 0 ? (rows[dst - stride + x - channels] ?? 0) : 0;
      const v = raw[src + x] ?? 0;
      let out: number;
      switch (filter) {
        case 0:
          out = v;
          break;
        case 1:
          out = v + a;
          break;
        case 2:
          out = v + b;
          break;
        case 3:
          out = v + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`Bad PNG filter ${String(filter)}.`);
      }
      rows[dst + x] = out & 0xff;
    }
  }
  if (channels === 4) return { width, height, pixels: rows };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba.set(rows.subarray(i * 3, i * 3 + 3), i * 4);
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, pixels: rgba };
}

// --- comparing ---------------------------------------------------------------------------

/** A pixel counts as different when any channel differs by more than this. */
export const CHANNEL_TOLERANCE = 16;
/** A render matches its golden when at most this share of pixels differ. */
export const PIXEL_TOLERANCE = 0.0005;

export interface Diff {
  readonly differing: number;
  readonly total: number;
  readonly sameSize: boolean;
}

export function diffImages(a: Image, b: Image, tolerance = CHANNEL_TOLERANCE): Diff {
  const total = a.width * a.height;
  if (a.width !== b.width || a.height !== b.height)
    return { differing: total, total, sameSize: false };
  let differing = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      if (Math.abs((a.pixels[i + c] ?? 0) - (b.pixels[i + c] ?? 0)) > tolerance) {
        differing++;
        break;
      }
    }
  }
  return { differing, total, sameSize: true };
}

export function matches(d: Diff): boolean {
  return d.sameSize && d.differing <= d.total * PIXEL_TOLERANCE;
}
