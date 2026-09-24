/**
 * A seller saw "Invalid IP address" on the payout form and was told their
 * payment details were wrong. They were not: Azure App Service writes the
 * client port into X-Forwarded-For ("85.240.12.34:57321"), the old helper in
 * connect.js accepted that as an IPv6 address because it contained a colon,
 * and Stripe rejected it.
 *
 * Verified against the live Stripe API: "85.240.12.34:57321" is refused with
 * "Invalid IP address", while a bare address, "::ffff:85.240.12.34" and an
 * absent ip are all accepted.
 */
const { normalizeIp, isPublicIp, publicClientIp, clientIpKey } = require('../src/utils/clientIp');

/** The shape Express hands a route, with only what these helpers read. */
function mockReq({ ip, forwarded, realIp, socket } = {}) {
  const headers = {};
  if (forwarded) headers['x-forwarded-for'] = forwarded;
  if (realIp) headers['x-real-ip'] = realIp;
  return { ip, headers, socket: socket ? { remoteAddress: socket } : undefined };
}

describe('normalizeIp', () => {
  it('strips the port Azure appends', () => {
    expect(normalizeIp('85.240.12.34:57321')).toBe('85.240.12.34');
  });

  it('unwraps a bracketed IPv6, with or without a port', () => {
    expect(normalizeIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(normalizeIp('[2001:db8::1]')).toBe('2001:db8::1');
  });

  it('unmaps IPv6-mapped IPv4', () => {
    expect(normalizeIp('::ffff:85.240.12.34')).toBe('85.240.12.34');
  });

  it('leaves a plain address alone and answers nothing for nothing', () => {
    expect(normalizeIp(' 85.240.12.34 ')).toBe('85.240.12.34');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    expect(normalizeIp('')).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });
});

describe('isPublicIp', () => {
  it('never mistakes an address with a port for IPv6 — the original bug', () => {
    expect(isPublicIp('85.240.12.34:57321')).toBe(false);
  });

  it('accepts a real public address', () => {
    expect(isPublicIp('85.240.12.34')).toBe(true);
    expect(isPublicIp('2001:db8::1')).toBe(true);
  });

  it('rejects everything that does not identify someone on the internet', () => {
    // Azure's own internal range is the one that used to slip through.
    ['100.64.0.1', '100.127.255.254', '10.0.0.1', '192.168.1.1', '172.16.0.1',
     '127.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '169.254.1.1', '0.0.0.0']
      .forEach((ip) => expect(isPublicIp(ip)).toBe(false));
  });

  it('rejects malformed input instead of passing it to Stripe', () => {
    ['999.1.1.1', '1.2.3', 'not-an-ip', '1.2.3.4.5', '010.1.1.1', '']
      .forEach((ip) => expect(isPublicIp(ip)).toBe(false));
  });

  it('keeps 172.16-31 private but 172.32 public', () => {
    expect(isPublicIp('172.31.255.255')).toBe(false);
    expect(isPublicIp('172.32.0.1')).toBe(true);
  });
});

describe('publicClientIp', () => {
  it('reads the address Azure appended, port and all', () => {
    expect(publicClientIp(mockReq({ ip: '85.240.12.34:57321' }))).toBe('85.240.12.34');
  });

  it('prefers req.ip over a header the caller could have forged', () => {
    const req = mockReq({ ip: '85.240.12.34:57321', forwarded: '1.1.1.1, 85.240.12.34:57321' });
    expect(publicClientIp(req)).toBe('85.240.12.34');
  });

  it('falls back through the header and the socket', () => {
    expect(publicClientIp(mockReq({ forwarded: '85.240.12.34, 100.64.0.1' }))).toBe('85.240.12.34');
    expect(publicClientIp(mockReq({ socket: '::ffff:85.240.12.34' }))).toBe('85.240.12.34');
  });

  it('skips Azure internal hops to find the real caller', () => {
    const req = mockReq({ ip: '100.64.0.1', forwarded: '100.64.0.1, 85.240.12.34:443' });
    expect(publicClientIp(req)).toBe('85.240.12.34');
  });

  it('answers null rather than inventing an address', () => {
    expect(publicClientIp(mockReq({ ip: '127.0.0.1' }))).toBeNull();
    expect(publicClientIp(mockReq())).toBeNull();
  });
});

describe('clientIpKey', () => {
  it('keeps private addresses, which are real callers in development', () => {
    expect(clientIpKey(mockReq({ ip: '127.0.0.1' }))).toBe('127.0.0.1');
    expect(clientIpKey(mockReq({ ip: '::ffff:10.0.0.4' }))).toBe('10.0.0.4');
  });

  it('strips the port so one caller is one bucket', () => {
    expect(clientIpKey(mockReq({ ip: '85.240.12.34:57321' }))).toBe('85.240.12.34');
  });

  it('always answers something', () => {
    expect(clientIpKey(mockReq())).toBe('unknown');
  });
});
