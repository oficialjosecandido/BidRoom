export interface LocalizableListing {
  title: string;
  description?: string;
  titlePt?: string | null;
  titleEn?: string | null;
  titleFr?: string | null;
  titleEs?: string | null;
  descriptionPt?: string | null;
  descriptionEn?: string | null;
  descriptionFr?: string | null;
  descriptionEs?: string | null;
}

export function getLocalizedTitle(listing: LocalizableListing, lang: string): string {
  if (lang === 'en' && listing.titleEn) return listing.titleEn;
  if (lang === 'pt' && listing.titlePt) return listing.titlePt;
  if (lang === 'fr' && listing.titleFr) return listing.titleFr;
  if (lang === 'es' && listing.titleEs) return listing.titleEs;
  return listing.title;
}

export function getLocalizedDescription(listing: LocalizableListing, lang: string): string {
  if (lang === 'en' && listing.descriptionEn) return listing.descriptionEn;
  if (lang === 'pt' && listing.descriptionPt) return listing.descriptionPt;
  if (lang === 'fr' && listing.descriptionFr) return listing.descriptionFr;
  if (lang === 'es' && listing.descriptionEs) return listing.descriptionEs;
  return listing.description ?? '';
}
