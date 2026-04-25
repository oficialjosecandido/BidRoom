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

const ABUSE_RE = /\b(fuck|shit|bitch|asshole|bastard|cunt|nigger|faggot|slut|whore|retard|idiot)\b/gi;
const HATE_RE = /\b(kill all|go back to your country|white power|heil hitler|gas the|race traitor|subhuman)\b/gi;

/**
 * Basic profanity / hate-speech scan for moderation triage.
 * This is intentionally conservative and is used only for flagging, not auto-deletion.
 * @param {string} text
 * @returns {{ found: boolean, categories: string[], matches: string[] }}
 */
function scanForAbusiveContent(text) {
  if (!text || typeof text !== 'string') return { found: false, categories: [], matches: [] };
  const categories = new Set();
  const matches = new Set();
  // String.prototype.match with /g flag returns an array of matches without
  // mutating regex state, so no lastIndex reset is needed here.
  const abuseMatches = text.match(ABUSE_RE) || [];
  const hateMatches = text.match(HATE_RE) || [];
  if (abuseMatches.length) {
    categories.add('profanity');
    abuseMatches.forEach((m) => matches.add(m.toLowerCase()));
  }
  if (hateMatches.length) {
    categories.add('hate_speech');
    hateMatches.forEach((m) => matches.add(m.toLowerCase()));
  }
  return {
    found: categories.size > 0,
    categories: [...categories],
    matches: [...matches]
  };
}

module.exports = { scanForContactInfo, scanTexts, scanForAbusiveContent };
