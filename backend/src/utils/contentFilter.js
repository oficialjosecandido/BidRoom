/**
 * Detects contact info (phone numbers, emails, external URLs) in user-provided text.
 * Used to prevent sellers from bypassing the platform by sharing direct contact details.
 */

const PHONE_RE = /(\+?\d[\s\-.]?){7,15}\d/g;

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+\s*@\s*[a-zA-Z0-9.\-]+\s*\.\s*[a-zA-Z]{2,}/g;

// Matches http(s)://, www., or bare domains with common TLDs
const URL_RE = /(?:https?:\/\/|www\.)[^\s,<>"']+|[a-zA-Z0-9\-]+\.(?:com|net|org|io|co|uk|pt|de|fr|es|it|nl|ru|info|biz|me|app|dev)[^\s,<>"']*/gi;

// Obfuscation patterns: "at" / "dot" replacements for email/domain
const OBFUSCATED_EMAIL_RE = /[a-zA-Z0-9._%+\-]+\s+(?:at|@)\s+[a-zA-Z0-9.\-]+\s+(?:dot|\.)\s+[a-zA-Z]{2,}/gi;

/**
 * Scans text for contact info.
 * @param {string} text
 * @returns {{ found: boolean, types: string[] }}
 */
function scanForContactInfo(text) {
  if (!text || typeof text !== 'string') return { found: false, types: [] };

  const types = new Set();

  if (EMAIL_RE.test(text) || OBFUSCATED_EMAIL_RE.test(text)) types.add('email');

  // Reset lastIndex after RegExp.test (stateful global regex)
  EMAIL_RE.lastIndex = 0;
  OBFUSCATED_EMAIL_RE.lastIndex = 0;

  if (URL_RE.test(text)) types.add('url');
  URL_RE.lastIndex = 0;

  // Phone: only flag if it looks intentional (7+ digits, possibly spaced/dashed)
  const phoneMatches = text.match(PHONE_RE);
  if (phoneMatches && phoneMatches.some(m => m.replace(/\D/g, '').length >= 7)) {
    types.add('phone');
  }

  return { found: types.size > 0, types: [...types] };
}

/**
 * Scans multiple text fields and returns combined result.
 * @param {string[]} texts
 * @returns {{ found: boolean, types: string[] }}
 */
function scanTexts(texts) {
  const allTypes = new Set();
  for (const text of texts) {
    const result = scanForContactInfo(text);
    result.types.forEach(t => allTypes.add(t));
  }
  return { found: allTypes.size > 0, types: [...allTypes] };
}

// EN + PT profanity (derivatives via \w* where applicable, explicit forms elsewhere)
const ABUSE_RE = /\b(fuck\w*|shit\w*|bitch\w*|asshole|bastard|cunt|nigger\w*|faggot|slut\w*|whore|retard|puta|putas|filho\s*da\s*puta|fdp|caralho|merda|porra|viado|bicha|corno)\b/gi;

// EN + PT hate speech
const HATE_RE = /\b(kill\s+all|go\s+back\s+to\s+your\s+country|white\s+power|heil\s+hitler|gas\s+the|race\s+traitor|subhuman|morte\s+a\s+todos\s+os|poder\s+branco|vai\s+para\s+o\s+teu\s+pa[ií]s)\b/gi;

/**
 * Normalize text for abusive-content scanning:
 * collapses leet-speak substitutions, removes repeated non-alpha chars,
 * and lowercases. Applied before regex matching to catch obfuscated slurs.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/@/g, 'a')
    .replace(/1/g, 'i')
    .replace(/!/g, 'i')
    .replace(/\$/g, 's')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/\+/g, 't')
    .replace(/\|/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score severity of an abusive-content result.
 * - 'low'    : profanity only, 1–2 matches
 * - 'medium' : profanity 3+ matches, OR 1 hate-speech match
 * - 'high'   : 2+ hate-speech matches, OR both profanity and hate-speech
 * @param {{ categories: string[], matches: string[] }} result
 * @returns {'low'|'medium'|'high'|null}
 */
function getAbuseSeverity(result) {
  if (!result.found) return null;
  const hasHate = result.categories.includes('hate_speech');
  const hasProfanity = result.categories.includes('profanity');
  const matchCount = result.matches.length;

  if (hasHate && matchCount >= 2) return 'high';
  if (hasHate && hasProfanity) return 'high';
  if (hasHate) return 'medium';
  if (hasProfanity && matchCount >= 3) return 'medium';
  return 'low';
}

/**
 * Scan text for profanity and hate speech, with leet-speak normalization.
 * Severity is included in the result so callers can apply tiered actions.
 * @param {string} text
 * @returns {{ found: boolean, categories: string[], matches: string[], severity: 'low'|'medium'|'high'|null }}
 */
function scanForAbusiveContent(text) {
  const normalized = normalizeText(text);
  if (!normalized) return { found: false, categories: [], matches: [], severity: null };

  const categories = new Set();
  const matches = new Set();

  const abuseMatches = normalized.match(ABUSE_RE) || [];
  const hateMatches = normalized.match(HATE_RE) || [];

  if (abuseMatches.length) {
    categories.add('profanity');
    abuseMatches.forEach((m) => matches.add(m));
  }
  if (hateMatches.length) {
    categories.add('hate_speech');
    hateMatches.forEach((m) => matches.add(m));
  }

  const result = {
    found: categories.size > 0,
    categories: [...categories],
    matches: [...matches]
  };
  result.severity = getAbuseSeverity(result);
  return result;
}

/**
 * Prohibited item keyword filter.
 * Returns the matched category name if the text contains a prohibited keyword,
 * or null if clean. Matching is case-insensitive and word-boundary aware.
 *
 * Covers: illegal firearms/ammo, live animals, controlled substances,
 * counterfeit goods, human remains/organs, CSAM.
 */
const PROHIBITED_PATTERNS = [
  { category: 'Illegal firearms',     re: /\b(firearm|handgun|pistol|revolver|rifle|shotgun|machine\s*gun|sawed.off|assault\s*weapon|ghost\s*gun|zip\s*gun|full\s*auto|suppressors?|silencers?|bump\s*stock)\b/i },
  { category: 'Ammunition/explosives',re: /\b(ammunition|ammo|bullet|cartridge|grenade|explosive|detonator|c4|pipe\s*bomb|ied|improvised\s*explosive)\b/i },
  { category: 'Illegal bladed weapons',re: /\b(switchblade|gravity\s*knife|brass\s*knuckle|knuckle\s*duster|push\s*dagger|throwing\s*star|shuriken|ballistic\s*knife)\b/i },
  { category: 'Live animals',          re: /\b(live\s+(animal|bird|reptile|fish|snake|turtle|parrot|puppy|kitten|rabbit|hamster|monkey|primate))\b/i },
  { category: 'Controlled substances', re: /\b(cocaine|heroin|methamphetamine|meth|fentanyl|lsd|ecstasy|mdma|crack|opioid|xanax\s+without|adderall\s+without)\b/i },
  { category: 'Counterfeit goods',     re: /\b(counterfeit|fake\s+(id|passport|license|currency|money|bill)|replica\s+currency|forged\s+document)\b/i },
  { category: 'Human remains/organs',  re: /\b(human\s+(organ|kidney|liver|heart|bone|skull|remains|tissue|blood)\s+(for\s+sale|selling))\b/i },
];

/**
 * Scans text for prohibited item keywords.
 * @param {string} text
 * @returns {{ prohibited: boolean, category: string|null }}
 */
function scanForProhibitedContent(text) {
  if (!text || typeof text !== 'string') return { prohibited: false, category: null };
  for (const { category, re } of PROHIBITED_PATTERNS) {
    if (re.test(text)) return { prohibited: true, category };
  }
  return { prohibited: false, category: null };
}

/**
 * Scans multiple text fields (title + description) for prohibited content.
 * @param {string[]} texts
 * @returns {{ prohibited: boolean, category: string|null }}
 */
function scanTextsForProhibitedContent(texts) {
  for (const text of texts) {
    const result = scanForProhibitedContent(text);
    if (result.prohibited) return result;
  }
  return { prohibited: false, category: null };
}

module.exports = {
  scanForContactInfo,
  scanTexts,
  scanForAbusiveContent,
  normalizeText,
  getAbuseSeverity,
  scanForProhibitedContent,
  scanTextsForProhibitedContent
};
