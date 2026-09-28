/**
 * Identify a draw-proof file from its first bytes rather than trusting the
 * extension or the Content-Type the browser sent.
 *
 * Video:
 *   MP4 / MOV (ISO base media): bytes 4–7 are "ftyp"; the major brand at 8–11
 *   is "qt  " for QuickTime, anything else (isom, mp42, avc1, M4V …) is MP4.
 *   WebM (Matroska / EBML):     starts with 1A 45 DF A3.
 *
 * Image:
 *   JPEG: FF D8 FF
 *   PNG:  89 50 4E 47
 *   GIF:  GIF87a / GIF89a
 *   WEBP: RIFF....WEBP
 *
 * @param {Buffer} buffer - at least the first 12 bytes of the file
 * @returns {{ mimetype: string, kind: 'video'|'image' }|null}
 */
function detectDrawMediaMagic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimetype: 'image/jpeg', kind: 'image' };
  }
  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mimetype: 'image/png', kind: 'image' };
  }
  // GIF
  const gif = buffer.toString('ascii', 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') {
    return { mimetype: 'image/gif', kind: 'image' };
  }
  // WEBP (RIFF....WEBP)
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mimetype: 'image/webp', kind: 'image' };
  }

  // MP4 / MOV
  if (buffer.toString('latin1', 4, 8) === 'ftyp') {
    const mimetype = buffer.toString('latin1', 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
    return { mimetype, kind: 'video' };
  }
  // WebM
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { mimetype: 'video/webm', kind: 'video' };
  }

  return null;
}

/** @deprecated Prefer detectDrawMediaMagic — kept for any callers that only need video. */
function detectVideoMagic(buffer) {
  const hit = detectDrawMediaMagic(buffer);
  return hit?.kind === 'video' ? hit.mimetype : null;
}

module.exports = { detectVideoMagic, detectDrawMediaMagic };
