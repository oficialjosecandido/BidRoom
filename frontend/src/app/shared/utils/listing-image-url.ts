import { API_CONFIG } from '../config/api.config';

const DEFAULT_PLACEHOLDER = '/images/placeholder-listing.svg';

/**
 * Resolves a listing image URL for <img src>. Handles absolute URLs, relative /api paths, and missing images.
 */
export function resolveListingImageUrl(raw: string | undefined | null): string {
  if (raw == null || String(raw).trim() === '') return DEFAULT_PLACEHOLDER;
  const u = String(raw).trim();
  if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:')) return u;
  if (u.startsWith('//')) return `https:${u}`;
  const base = API_CONFIG.getBackendBaseUrl().replace(/\/$/, '');
  if (u.startsWith('/')) return `${base}${u}`;
  return u;
}

export function firstListingImageUrl(images: string[] | undefined | null): string {
  const first = images?.[0];
  return resolveListingImageUrl(first);
}
