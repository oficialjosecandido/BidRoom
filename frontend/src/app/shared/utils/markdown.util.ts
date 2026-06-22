import { marked } from 'marked';

marked.setOptions({ breaks: false, gfm: true });

/**
 * Markdown -> HTML. The result is bound via [innerHTML], which Angular's
 * DomSanitizer scrubs automatically (script tags, event handlers, etc.) —
 * no separate sanitizer needed, and this stays SSR-safe since `marked` has
 * no DOM dependency (unlike DOMPurify, which needs window/document).
 */
export function renderMarkdown(markdown: string): string {
  const result = marked.parse(markdown ?? '', { async: false });
  return typeof result === 'string' ? result : '';
}
