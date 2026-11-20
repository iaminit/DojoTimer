import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resDir = resolve(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

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
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
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

function renderDojoLauncherPixels(size, { transparentBg = false, scale = 1.0, roundClip = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const outerR = size * 0.38 * scale;
  const innerR = size * 0.285 * scale;
  const dotR = size * 0.095 * scale;
  const aa = 1.2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);

      let bgAlpha = transparentBg ? 0 : 1;
      if (roundClip && !transparentBg) {
        const clipR = size * 0.48;
        if (dist > clipR + aa) {
          bgAlpha = 0;
        } else if (dist > clipR - aa) {
          bgAlpha = Math.max(0, Math.min(1, (clipR + aa - dist) / (2 * aa)));
        }
      }

      let alphaRing = 0;
      if (dist >= innerR - aa && dist <= outerR + aa) {
        const innerFade = Math.min(1, Math.max(0, (dist - (innerR - aa)) / (2 * aa)));
        const outerFade = Math.min(1, Math.max(0, (outerR + aa - dist) / (2 * aa)));
        alphaRing = Math.min(innerFade, outerFade);
      }

      let alphaDot = 0;
      if (dist <= dotR + aa) {
        alphaDot = Math.min(1, Math.max(0, (dotR + aa - dist) / (2 * aa)));
      }

      const intensity = Math.max(alphaRing, alphaDot * 0.92);
      const idx = (y * size + x) * 4;

      if (transparentBg) {
        buf[idx] = 255;
        buf[idx + 1] = 214;
        buf[idx + 2] = 0;
        buf[idx + 3] = Math.round(255 * intensity);
      } else {
        buf[idx] = Math.round(255 * intensity);
        buf[idx + 1] = Math.round(214 * intensity);
        buf[idx + 2] = 0;
        buf[idx + 3] = Math.round(255 * bgAlpha);
      }
    }
  }
  return buf;
}

const densities = [
  { folder: 'mipmap-mdpi', iconSize: 48, fgSize: 108 },
  { folder: 'mipmap-hdpi', iconSize: 72, fgSize: 162 },
  { folder: 'mipmap-xhdpi', iconSize: 96, fgSize: 216 },
  { folder: 'mipmap-xxhdpi', iconSize: 144, fgSize: 324 },
  { folder: 'mipmap-xxxhdpi', iconSize: 192, fgSize: 432 },
];

for (const d of densities) {
  const dir = resolve(resDir, d.folder);
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    resolve(dir, 'ic_launcher.png'),
    encodePng(d.iconSize, d.iconSize, renderDojoLauncherPixels(d.iconSize)),
  );
  writeFileSync(
    resolve(dir, 'ic_launcher_round.png'),
    encodePng(d.iconSize, d.iconSize, renderDojoLauncherPixels(d.iconSize, { roundClip: true })),
  );
  writeFileSync(
    resolve(dir, 'ic_launcher_foreground.png'),
    encodePng(
      d.fgSize,
      d.fgSize,
      renderDojoLauncherPixels(d.fgSize, { transparentBg: true, scale: 0.66 }),
    ),
  );
}

const valuesDir = resolve(resDir, 'values');
mkdirSync(valuesDir, { recursive: true });
writeFileSync(
  resolve(valuesDir, 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#000000</color>
</resources>
`,
  'utf8',
);

console.log('Generated Android launcher icons in android/app/src/main/res/');
