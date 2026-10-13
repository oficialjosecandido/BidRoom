/**
 * Flexible catalogue search.
 *
 * The old path treated the whole query as one literal substring, so
 * "relógio de homem" missed "Relogio de Homem" (accent) and "relogio homem"
 * missed it too (missing "de"). Tokens + diacritic-insensitive regex fix both.
 */

const STOPWORDS = new Set([
  // Portuguese
  'a', 'as', 'o', 'os', 'um', 'uma', 'uns', 'umas',
  'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas',
  'e', 'ou', 'para', 'por', 'com', 'sem', 'ao', 'aos',
  // English
  'the', 'of', 'and', 'or', 'for', 'to', 'in', 'on', 'at', 'a', 'an',
  // Spanish
  'el', 'la', 'los', 'las', 'un', 'una', 'y', 'en', 'del',
  // French
  'le', 'les', 'un', 'une', 'des', 'du', 'et', 'ou'
]);

/** Base letter → every common accented form we want to treat as the same. */
const DIACRITIC_CLASS = {
  a: 'aáàâãäåăạảấầẩẫậắằẳẵặ',
  e: 'eéèêëẻẽẹếềểễệ',
  i: 'iíìîïịỉĩ',
  o: 'oóòôõöọỏốồổỗộớờởỡợ',
  u: 'uúùûüụủứừửữự',
  c: 'cçć',
  n: 'nñń',
  y: 'yýỳỷỹỵ'
};

const SEARCH_FIELDS = [
  'title', 'titlePt', 'titleEn', 'titleFr', 'titleEs',
  'description', 'descriptionPt', 'descriptionEn', 'descriptionFr', 'descriptionEs'
];

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip combining marks so callers can compare folded strings in tests. */
function stripDiacritics(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Split a user query into meaningful search tokens.
 * Drops stopwords and anything shorter than 2 chars after folding.
 */
function tokenizeSearchQuery(raw) {
  const cleaned = String(raw || '')
    .trim()
    .slice(0, 200)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];

  const seen = new Set();
  const tokens = [];
  for (const part of cleaned.split(' ')) {
    if (!part || STOPWORDS.has(part)) continue;
    const folded = stripDiacritics(part);
    if (folded.length < 2) continue;
    if (seen.has(folded)) continue;
    seen.add(folded);
    tokens.push(part);
  }
  return tokens;
}

/** Turn one token into a regex source that matches accented variants. */
function toAccentInsensitivePattern(token) {
  return [...String(token)].map((ch) => {
    const base = stripDiacritics(ch).toLowerCase();
    const chars = DIACRITIC_CLASS[base];
    if (chars) return `[${chars}]`;
    return escapeRegex(ch);
  }).join('');
}

/**
 * Mongo filter fragment for catalogue search, or null when the query is empty
 * after tokenization.
 *
 * Every token must appear in at least one searchable field (AND across tokens,
 * OR across fields). Tokens may appear in any order and with words in between.
 */
function buildListingSearchClause(rawSearch) {
  const tokens = tokenizeSearchQuery(rawSearch);
  if (tokens.length === 0) return null;

  const tokenClauses = tokens.map((token) => {
    const pattern = toAccentInsensitivePattern(token);
    return {
      $or: SEARCH_FIELDS.map((field) => ({
        [field]: { $regex: pattern, $options: 'i' }
      }))
    };
  });

  return tokenClauses.length === 1 ? tokenClauses[0] : { $and: tokenClauses };
}

module.exports = {
  STOPWORDS,
  SEARCH_FIELDS,
  escapeRegex,
  stripDiacritics,
  tokenizeSearchQuery,
  toAccentInsensitivePattern,
  buildListingSearchClause
};
