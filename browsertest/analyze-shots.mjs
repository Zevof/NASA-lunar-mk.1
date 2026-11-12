import { readFileSync, readdirSync } from 'fs';
import zlib from 'zlib';

// Minimal PNG decoder: IHDR + IDAT -> raw RGBA (supports color type 6/2, 8-bit)
function decodePNG(path) {
const buf = readFileSync(path);
let off = 8; // skip signature
let w = 0, h = 0, bitDepth = 0, colorType = 0;
const idat = [];
while (off < buf.length) {
const len = buf.readUInt32BE(off);
const type = buf.toString('ascii', off + 4, off + 8);
const dataStart = off + 8;
if (type === 'IHDR') {
w = buf.readUInt32BE(dataStart);
h = buf.readUInt32BE(dataStart + 4);
bitDepth = buf[dataStart + 8];
colorType = buf[dataStart + 9];
} else if (type === 'IDAT') {
idat.push(buf.subarray(dataStart, dataStart + len));
} else if (type === 'IEND') break;
off = dataStart + len + 4;
}
if (bitDepth !== 8) return { w, h, bitDepth, colorType, unsupported: true };
const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
if (!channels) return { w, h, bitDepth, colorType, unsupported: true };
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = w * channels;
const out = Buffer.alloc(h * stride);
let pos = 0;
for (let y = 0; y < h; y++) {
const filter = raw[pos++];
const rowStart = y * stride;
for (let x = 0; x < stride; x++) {
const rawByte = raw[pos++];
const a = x >= channels ? out[rowStart + x - channels] : 0;
const b = y > 0 ? out[rowStart - stride + x] : 0;
const c = (x >= channels && y > 0) ? out[rowStart - stride + x - channels] : 0;
let v;
switch (filter) {
case 0: v = rawByte; break;
case 1: v = rawByte + a; break;
case 2: v = rawByte + b; break;
case 3: v = rawByte + ((a + b) >> 1); break;
case 4: {
const p = a + b - c;
const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
v = rawByte + pred; break;
}
default: v = rawByte;
}
out[rowStart + x] = v & 0xff;
}
}
return { w, h, channels, data: out };
}

function stats(path) {
try {
const png = decodePNG(path);
if (png.unsupported) return { err: 'unsupported', bitDepth: png.bitDepth, colorType: png.colorType };
const { w, h, channels, data } = png;
const colors = new Set();
let nonBlack = 0, total = 0;
let rSum = 0, gSum = 0, bSum = 0;
for (let i = 0; i < data.length; i += channels) {
const r = data[i], g = channels >= 3 ? data[i + 1] : data[i], b = channels >= 3 ? data[i + 2] : data[i];
rSum += r; gSum += g; bSum += b;
if (r + g + b > 30) nonBlack++;
total++;
// Quantisiere Farben (nach 4 Bit pro Kanal) für Vielfalt
const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
colors.add(key);
}
return {
w, h,
uniqueColors: colors.size,
nonBlackPct: +(100 * nonBlack / total).toFixed(1),
avgRGB: [Math.round(rSum / total), Math.round(gSum / total), Math.round(bSum / total)]
};
} catch (e) {
return { err: e.message };
}
}

const dir = 'C:/Users/sahin/Downloads/NASA lunar/lunar-link-planner/browsertest/planet-shots';
const files = readdirSync(dir).filter(f => (f.startsWith('gpu-') || f.startsWith('focus-')) && f.endsWith('.png'));
console.log('=== VISUELLE ANALYSE (nach Fokus) ===');
for (const f of files.sort()) {
const s = stats(dir + '/' + f);
if (s.err) { console.log(f.padEnd(22), 'ERR:', s.err, 'bd=' + s.bitDepth, 'ct=' + s.colorType); continue; }
console.log(
f.padEnd(22),
'uniqueColors=' + String(s.uniqueColors).padStart(5),
'nonBlack=' + String(s.nonBlackPct).padStart(5) + '%',
'avgRGB=[' + s.avgRGB.join(',') + ']'
);
}
