import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";

function png(size) {
  const raw = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;
      const bg = nx * 0.15 + ny * 0.05;
      let r = 8 + bg * 20;
      let g = 9 + bg * 16;
      let b = 13 + bg * 18;
      const peak = Math.abs(ny - (0.72 - Math.abs(nx - 0.42) * 0.95));
      if (peak < 0.025 && nx > 0.12 && nx < 0.86) {
        r = 245; g = 185; b = 66;
      }
      const o = (row.length && 4) * x + 1;
      row[o] = r; row[o + 1] = g; row[o + 2] = b; row[o + 3] = 255;
    }
    raw.push(row);
  }
  const data = deflateSync(Buffer.concat(raw));
  const chunk = (type, body) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4);
    const crcVal = crc32(Buffer.concat([t, body]));
    crc.writeUInt32BE(crcVal >>> 0);
    return Buffer.concat([len, t, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", data), chunk("IEND", Buffer.alloc(0))]);
}

const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = table[(c ^ byte) & 255] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192));
writeFileSync("public/icons/icon-512.png", png(512));
console.log("icons ok");
