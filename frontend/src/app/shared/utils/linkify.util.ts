/**
 * Escape plain text, then turn http(s) URLs into safe <a> tags.
 * Bind the result with [innerHTML] (prefer via LinkifyPipe, which trusts
 * only this pre-escaped output).
 */
export function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const URL_RE = /(https?:\/\/[^\s<>"']+)/gi;

export function linkifyText(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(URL_RE, (raw) => {
    let url = raw;
    let trailing = '';
    // Keep sentence punctuation outside the link.
    while (/[.,;:!?)\]']$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }
    if (!url) return raw;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
  });
}
