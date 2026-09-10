/** Responsive WebP widths generated alongside listing originals in Azure. */
export type ListingImageSize = 'thumb' | 'card' | 'full';

const SIZE_WIDTH: Record<Exclude<ListingImageSize, 'full'>, number> = {
  thumb: 480,
  card: 960,
};

/**
 * Derive a resized WebP URL from an original Azure blob URL.
 * `…/uuid-name.jpg` → `…/uuid-name.jpg-w480.webp` (or -w960).
 * Returns the original when size is `full` or the URL is empty / already a variant.
 */
export function listingImageSrc(url: string | null | undefined, size: ListingImageSize = 'card'): string {
  const src = String(url || '').trim();
  if (!src || size === 'full') return src;
  if (/-w(480|960)\.webp(\?|$)/i.test(src)) return src;

  const width = SIZE_WIDTH[size];
  return src.replace(/(\?.*)?$/, `-w${width}.webp$1`);
}

/**
 * If a variant 404s, fall back to the original URL once.
 * Bind: (error)="onListingImageError($event, originalUrl)"
 */
export function onListingImageError(event: Event, originalUrl: string): void {
  const img = event.target as HTMLImageElement | null;
  if (!img || !originalUrl) return;
  if (img.dataset['fallbackApplied'] === '1') return;
  img.dataset['fallbackApplied'] = '1';
  img.src = originalUrl;
}
