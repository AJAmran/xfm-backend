import { deflateSync } from "node:zlib";

/**
 * Minimal PNG encoder (8-bit RGBA, no interlace).
 *
 * The document module needs real PNG signature images — a PDF cannot be
 * rendered by an `<img>` tag — and pulling in an image library for a few
 * hundred bytes of output is not worth the dependency. Node's zlib does the
 * compression; everything else here is the PNG container spec.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

export interface Rgba {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes per pixel. */
  data: Uint8Array;
}

/** Encodes an RGBA buffer as a PNG. */
export function encodePng(image: Rgba): Buffer {
  const { width, height, data } = image;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline is prefixed with its filter byte (0 = None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Draws a cursive-looking signature stroke on a transparent canvas.
 *
 * Deterministic per `seed` so a re-run reproduces byte-identical images, which
 * keeps the stored SHA-256 in `signature_placements` meaningful.
 */
export function createSignatureImage(seed: number, width = 320, height = 110): Buffer {
  const data = new Uint8Array(width * height * 4);
  const ink = [15, 23, 42, 255] as const; // near-black

  const setPixel = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 4;
    data[index] = ink[0];
    data[index + 1] = ink[1];
    data[index + 2] = ink[2];
    data[index + 3] = ink[3];
  };

  // Bresenham line with a small brush, so strokes look hand-drawn.
  const line = (x0: number, y0: number, x1: number, y1: number, thickness: number) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const cx = Math.round(x0 + (x1 - x0) * t);
      const cy = Math.round(y0 + (y1 - y0) * t);
      for (let dy = -thickness; dy <= thickness; dy += 1) {
        for (let dx = -thickness; dx <= thickness; dx += 1) {
          if (dx * dx + dy * dy <= thickness * thickness) setPixel(cx + dx, cy + dy);
        }
      }
    }
  };

  const mid = height / 2;
  const phase = (seed % 7) * 0.6;
  let previousX = 12;
  let previousY = mid + Math.sin(phase) * 8;

  // One flowing cursive path across the canvas.
  for (let x = 12; x < width - 12; x += 1) {
    const t = (x / width) * Math.PI * 4.2 + phase;
    const y =
      mid +
      Math.sin(t) * (18 - Math.abs(t - 6) * 0.9) +
      Math.sin(x / 7 + seed) * 3;
    line(previousX, previousY, x, Math.round(y), 1);
    previousX = x;
    previousY = y;
  }

  // Underline.
  line(16, height - 20, width - 40, height - 24, 0);

  return encodePng({ width, height, data });
}