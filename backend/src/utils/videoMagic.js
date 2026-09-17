/**
 * Identify a video file from its first bytes rather than trusting the
 * extension or the Content-Type the browser sent.
 *
 *   MP4 / MOV (ISO base media): bytes 4–7 are "ftyp"; the major brand at 8–11
 *   is "qt  " for QuickTime, anything else (isom, mp42, avc1, M4V …) is MP4.
 *   WebM (Matroska / EBML):     starts with 1A 45 DF A3.
 *
 * @param {Buffer} buffer - at least the first 12 bytes of the file
 * @returns {'video/mp4'|'video/quicktime'|'video/webm'|null}
 */
function detectVideoMagic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.toString('latin1', 4, 8) === 'ftyp') {
    return buffer.toString('latin1', 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return 'video/webm';
  }
  return null;
}

module.exports = { detectVideoMagic };
