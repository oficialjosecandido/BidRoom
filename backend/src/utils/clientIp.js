/**
 * One place to turn whatever the proxy handed us into an IP address.
 *
 * Azure App Service writes the client *port* into X-Forwarded-For
 * ("85.240.12.34:57321"). Every caller has to strip that, and the copy in
 * connect.js did not — worse, it accepted the result as an IPv6 address
 * because it contained a colon, and sent it to Stripe as the ToS acceptance
 * IP. Stripe answered "Invalid IP address" and the seller was told their
 * payment details were wrong.
 *
 * `req.ip` is preferred over the X-Forwarded-For header: with `trust proxy`
 * set to 1 (see index.js) Express returns the address Azure itself appended,
 * whereas the leftmost header entry is whatever the caller chose to send. For
 * a compliance record — which is what tos_acceptance.ip is — no IP is better
 * than one the seller could have forged.
 */

/** Strips the noise proxies add: brackets, a trailing port, IPv6-mapped IPv4. */
function normalizeIp(raw) {
  if (!raw) return null;
  let ip = String(raw).trim();
  if (!ip) return null;

  // "[2001:db8::1]:443" or "[2001:db8::1]" → "2001:db8::1"
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) ip = bracketed[1];

  // "85.240.12.34:57321" → "85.240.12.34" (Azure App Service / ARR)
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.replace(/:\d+$/, '');

  // "::ffff:85.240.12.34" → "85.240.12.34"
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) ip = mapped[1];

  return ip || null;
}

function isPublicIpv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  // Reject a leading zero ("010.1.1.1"), which Number() would quietly accept.
  if (parts.some((p) => p.length > 1 && p.startsWith('0'))) return false;

  const [a, b] = octets;
  if (a === 0 || a === 127) return false;              // this host / loopback
  if (a === 10) return false;                          // RFC 1918
  if (a === 192 && b === 168) return false;            // RFC 1918
  if (a === 172 && b >= 16 && b <= 31) return false;   // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return false;  // RFC 6598 CGNAT — Azure internal
  if (a === 169 && b === 254) return false;            // link-local
  if (a >= 224) return false;                          // multicast / reserved
  return true;
}

function isPublicIpv6(ip) {
  // Hex groups and colons only — this is what stopped "1.2.3.4:5678" from
  // being mistaken for IPv6.
  if (!/^[0-9a-f:]+$/i.test(ip) || !ip.includes(':')) return false;
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return false; // unspecified / loopback
  if (lower.startsWith('fe80')) return false;          // link-local
  if (/^f[cd]/.test(lower)) return false;              // unique local
  return true;
}

/** True when `ip` is an address that identifies someone on the public internet. */
function isPublicIp(ip) {
  if (!ip) return false;
  return ip.includes(':') ? isPublicIpv6(ip) : isPublicIpv4(ip);
}

/** Every candidate address for this request, best source first. */
function ipCandidates(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  return [
    req?.ip,
    ...(forwarded ? String(forwarded).split(',') : []),
    req?.headers?.['x-real-ip'],
    req?.socket?.remoteAddress,
    req?.connection?.remoteAddress
  ];
}

/**
 * The caller's public IP, or null when the proxy chain never revealed one.
 * Null is a real answer: callers must handle it rather than invent an address.
 */
function publicClientIp(req) {
  for (const candidate of ipCandidates(req)) {
    const ip = normalizeIp(candidate);
    if (isPublicIp(ip)) return ip;
  }
  return null;
}

/**
 * A stable key for rate limiting and audit records, which need *something*
 * for every request — private and loopback addresses included, since those
 * are real callers in development.
 */
function clientIpKey(req) {
  for (const candidate of ipCandidates(req)) {
    const ip = normalizeIp(candidate);
    if (ip) return ip;
  }
  return 'unknown';
}

module.exports = { normalizeIp, isPublicIp, publicClientIp, clientIpKey };
