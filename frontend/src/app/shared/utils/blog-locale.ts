export interface LocalizableBlogPost {
  title: string;
  titleEn?: string;
  excerpt?: string;
  excerptEn?: string;
  content?: string;
  contentEn?: string;
  metaDescription?: string;
  metaDescriptionEn?: string;
}

export function getLocalizedBlogTitle(post: LocalizableBlogPost, lang: string): string {
  if (lang === 'en' && post.titleEn) return post.titleEn;
  return post.title;
}

export function getLocalizedBlogExcerpt(post: LocalizableBlogPost, lang: string): string {
  if (lang === 'en' && post.excerptEn) return post.excerptEn;
  return post.excerpt ?? '';
}

export function getLocalizedBlogContent(post: LocalizableBlogPost, lang: string): string {
  if (lang === 'en' && post.contentEn) return post.contentEn;
  return post.content ?? '';
}

export function getLocalizedBlogMetaDescription(post: LocalizableBlogPost, lang: string): string {
  if (lang === 'en' && post.metaDescriptionEn) return post.metaDescriptionEn;
  return post.metaDescription ?? '';
}
