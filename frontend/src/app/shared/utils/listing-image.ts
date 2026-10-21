/** Responsive WebP widths generated alongside listing originals in Azure. */
export type ListingImageSize = 'micro' | 'thumb' | 'mid' | 'card' | 'full';

const SIZE_WIDTH: Record<Exclude<ListingImageSize, 'full'>, number> = {
  micro: 160,
  thumb: 480,
  mid: 640,
  card: 960,
};

const VARIANT_RE = /-w(160|480|640|960)\.webp(\?|$)/i;

/**
 * Derive a resized WebP URL from an original Azure blob URL.
 * `…/uuid-name.jpg` → `…/uuid-name.jpg-w480.webp` (etc.).
 * Returns the original when size is `full` or the URL is empty / already a variant.
 */
export function listingImageSrc(url: string | null | undefined, size: ListingImageSize = 'card'): string {
  const src = String(url || '').trim();
  if (!src || size === 'full') return src;
  if (VARIANT_RE.test(src)) return src;

  const width = SIZE_WIDTH[size];
  return src.replace(/(\?.*)?$/, `-w${width}.webp$1`);
}

/**
 * Responsive srcset for the listing hero.
 * Phone ~480–640, larger viewports 960 — keeps mobile LCP off the desktop file.
 */
export function listingImageSrcSet(url: string | null | undefined): string {
  const src = String(url || '').trim();
  if (!src) return '';
  const w480 = listingImageSrc(src, 'thumb');
  const w640 = listingImageSrc(src, 'mid');
  const w960 = listingImageSrc(src, 'card');
  if (w480 === w960) return '';
  return `${w480} 480w, ${w640} 640w, ${w960} 960w`;
}

/** Matches the listing-details gallery layout (padded mobile, ~800px desktop). */
export const LISTING_HERO_SIZES = '(max-width: 840px) calc(100vw - 32px), 800px';

/**
 * If a variant 404s, try the next larger WebP before falling back to the original.
 * Bind: (error)="onListingImageError($event, originalUrl)"
 */
export function onListingImageError(event: Event, originalUrl: string): void {
  const img = event.target as HTMLImageElement | null;
  if (!img || !originalUrl) return;

  const step = Number(img.dataset['fallbackStep'] || '0');
  img.removeAttribute('srcset');

  // Prefer a capped WebP over a multi‑MB original when smaller variants 404.
  if (step === 0) {
    img.dataset['fallbackStep'] = '1';
    const mid = listingImageSrc(originalUrl, 'mid');
    if (mid && mid !== img.src) {
      img.src = mid;
      return;
    }
  }
  if (step <= 1) {
    img.dataset['fallbackStep'] = '2';
    const card = listingImageSrc(originalUrl, 'card');
    if (card && card !== img.src) {
      img.src = card;
      return;
    }
  }
  if (img.dataset['fallbackApplied'] === '1') return;
  img.dataset['fallbackApplied'] = '1';
  img.src = originalUrl;
}
