/**
 * Generates a lightweight device fingerprint from available browser signals.
 * No external library required. The hash is non-cryptographic but stable
 * across sessions on the same device/browser configuration.
 *
 * Signals used: user-agent, screen resolution, timezone, language, color depth,
 * platform, hardware concurrency, device memory.
 *
 * The fingerprint is cached in sessionStorage so it is consistent within a session.
 */

const CACHE_KEY = 'br_dfp';

function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep unsigned 32-bit
  }
  return hash.toString(16).padStart(8, '0');
}

function collectSignals(): string {
  const nav = navigator as any;
  const signals = [
    nav.userAgent || '',
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    nav.language || '',
    nav.platform || '',
    String(nav.hardwareConcurrency || 0),
    String(nav.deviceMemory || 0)
  ];
  return signals.join('|');
}

export function getDeviceFingerprint(): string {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) return cached;

    const fp = djb2Hash(collectSignals());
    sessionStorage.setItem(CACHE_KEY, fp);
    return fp;
  } catch {
    // SSR or restricted storage — return a stable empty string
    return '';
  }
}
