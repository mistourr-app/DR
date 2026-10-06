// Minimal PNG encoder built on the Node standard library only.
//
// The project ships no image dependencies on purpose: sprite generation must
// stay reproducible with a bare `npm ci`. A PNG is a signature, an IHDR, an
// IDAT holding zlib-deflated scanlines, and an IEND, each with a CRC32.
//
// Node 20.12+ and 22.2+ expose zlib.crc32. Older runtimes get a table-driven
// fallback so this script keeps working outside CI.

import zlib from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32Fallback(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

export function crc32(buffer) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buffer) >>> 0;
  return crc32Fallback(buffer);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);

  return Buffer.concat([length, typeAndData, crc]);
}

// filters are per-scanline bytes prepended to the row: 0 keeps the row raw.
function buildScanlines(pixels, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }

  return raw;
}

export function encodePng(pixels, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`encodePng: bad dimensions ${width}x${height}`);
  }

  const expected = width * height * 4;
  if (pixels.length !== expected) {
    throw new Error(`encodePng: expected ${expected} bytes of RGBA, got ${pixels.length}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const idat = zlib.deflateSync(buildScanlines(pixels, width, height), { level: 9 });

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A plain RGBA canvas with the few primitives the sprite generator needs.
// Everything is alpha-composited so overlapping shapes blend instead of
// replacing each other, which keeps the sprite edges from looking cut out.
export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);
  }

  blend(x, y, [r, g, b], alpha) {
    if (alpha <= 0) return;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;

    const i = (y * this.width + x) * 4;
    const dstA = this.data[i + 3] / 255;
    const srcA = Math.min(1, alpha);
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) {
      this.data[i] = 0;
      this.data[i + 1] = 0;
      this.data[i + 2] = 0;
      this.data[i + 3] = 0;
      return;
    }

    const mix = (src, dst, dstWeight) =>
      Math.round((src * srcA + dst * dstWeight * (1 - srcA)) / outA);

    this.data[i] = mix(r, this.data[i], dstA);
    this.data[i + 1] = mix(g, this.data[i + 1], dstA);
    this.data[i + 2] = mix(b, this.data[i + 2], dstA);
    this.data[i + 3] = Math.round(outA * 255);
  }

  fillRect(x, y, w, h, colour, alpha = 1) {
    for (let py = Math.floor(y); py < Math.floor(y + h); py += 1) {
      for (let px = Math.floor(x); px < Math.floor(x + w); px += 1) {
        this.blend(px, py, colour, alpha);
      }
    }
  }

  fillCircle(cx, cy, r, colour, alpha = 1) {
    const r2 = r * r;
    for (let py = Math.floor(cy - r); py <= Math.ceil(cy + r); py += 1) {
      for (let px = Math.floor(cx - r); px <= Math.ceil(cx + r); px += 1) {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.blend(px, py, colour, alpha);
      }
    }
  }

  fillEllipse(cx, cy, rx, ry, colour, alpha = 1) {
    for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry); py += 1) {
      for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px += 1) {
        const dx = (px + 0.5 - cx) / rx;
        const dy = (py + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.blend(px, py, colour, alpha);
      }
    }
  }

  toPng() {
    return encodePng(this.data, this.width, this.height);
  }
}