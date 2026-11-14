'use strict';
// Deterministic app icon, using only Node built-ins.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const label = Buffer.from(type); const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); label.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([label, data])), data.length + 8); return result;
}
const size = 80; const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const offset = y * (size * 4 + 1) + 1 + x * 4;
  const foreground = (x >= 23 && x <= 34 && y >= 18 && y <= 61) || (x >= 23 && x <= 59 && y >= 50 && y <= 61);
  raw.set(foreground ? [168, 230, 217, 255] : [19, 28, 42, 255], offset);
}
const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
fs.writeFileSync(path.join(__dirname, '../app/icon.png'), Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
]));
