export interface LocalizableListing {
  title: string;
  description?: string;
  titlePt?: string | null;
  titleEn?: string | null;
  descriptionPt?: string | null;
  descriptionEn?: string | null;
}

export function getLocalizedTitle(listing: LocalizableListing, lang: string): string {
  if (lang === 'en' && listing.titleEn) return listing.titleEn;
  if (lang === 'pt' && listing.titlePt) return listing.titlePt;
  return listing.title;
}

export function getLocalizedDescription(listing: LocalizableListing, lang: string): string {
  if (lang === 'en' && listing.descriptionEn) return listing.descriptionEn;
  if (lang === 'pt' && listing.descriptionPt) return listing.descriptionPt;
  return listing.description ?? '';
}
