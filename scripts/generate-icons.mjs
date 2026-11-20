import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '..', 'public');
mkdirSync(publicDir, { recursive: true });

// Precompute CRC32 table for valid PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter type 0
    rgbaBuffer.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderIconPixels(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const outerR = size * 0.38;
  const innerR = size * 0.285;
  const dotR = size * 0.095;
  const aa = 1.2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);

      // Gold #FFD600 -> (255, 214, 0) on pure OLED black #000000
      let alphaRing = 0;
      if (dist >= innerR - aa && dist <= outerR + aa) {
        const innerFade = Math.min(1, Math.max(0, (dist - (innerR - aa)) / (2 * aa)));
        const outerFade = Math.min(1, Math.max(0, (outerR + aa - dist) / (2 * aa)));
        alphaRing = Math.min(innerFade, outerFade);
      }

      // Subtle inner progress tick bar at top-right quadrant + center dot
      let alphaDot = 0;
      if (dist <= dotR + aa) {
        alphaDot = Math.min(1, Math.max(0, (dotR + aa - dist) / (2 * aa)));
      }

      // Subtle dark track outside/inside
      const intensity = Math.max(alphaRing, alphaDot * 0.92);
      const r = Math.round(255 * intensity);
      const g = Math.round(214 * intensity);
      const b = 0;

      const idx = (y * size + x) * 4;
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = 255;
    }
  }
  return buf;
}

const sizes = [
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const item of sizes) {
  const pixels = renderIconPixels(item.size);
  const png = encodePng(item.size, item.size, pixels);
  writeFileSync(resolve(publicDir, item.name), png);
}

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#000000"/>
  <circle cx="256" cy="256" r="176" fill="none" stroke="#1A1A1A" stroke-width="28"/>
  <circle cx="256" cy="256" r="176" fill="none" stroke="#FFD600" stroke-width="28" stroke-dasharray="830 280" stroke-linecap="round" transform="rotate(-90 256 256)"/>
  <circle cx="256" cy="256" r="46" fill="#FFD600"/>
</svg>
`;
writeFileSync(resolve(publicDir, 'pwa-icon.svg'), svgContent, 'utf8');
console.log('Generated PWA icons in public/');
