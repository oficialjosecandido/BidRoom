/**
 * Generates a minimal valid PNG using only Node.js built-ins (zlib).
 * Returns a Buffer containing the PNG file.
 */
const zlib = require('zlib');

function crc32(buf) {
  const table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf    = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf    = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

/**
 * Generate a solid-colour PNG.
 * @param {number} w - width in pixels
 * @param {number} h - height in pixels
 * @param {{r,g,b}} bg - background colour
 * @param {{r,g,b}} [text] - optional text colour (not drawn — just for colour contrast)
 * @returns {Buffer}
 */
function generateSolidPNG(w, h, bg) {
  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.writeUInt8(8, 8);  // 8 bits per channel
  ihdr.writeUInt8(2, 9);  // colour type: RGB
  // compression=0, filter=0, interlace=0

  // Raw image data: one filter byte (0=None) + RGB per row
  const row    = Buffer.alloc(1 + w * 3);
  row[0] = 0;
  for (let x = 0; x < w; x++) {
    row[1 + x * 3]     = bg.r;
    row[1 + x * 3 + 1] = bg.g;
    row[1 + x * 3 + 2] = bg.b;
  }
  const rawRows = Buffer.concat(Array(h).fill(row));
  const idat    = zlib.deflateSync(rawRows, { level: 1 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Cached BidRoom brand PNG (1200×630, dark background #0A0A0A)
let _brandPng = null;
function getBrandPNG() {
  if (!_brandPng) {
    _brandPng = generateSolidPNG(1200, 630, { r: 10, g: 10, b: 10 });
  }
  return _brandPng;
}

module.exports = { generateSolidPNG, getBrandPNG };
