/**
 * Sending a transactional email in the recipient's own language.
 *
 * Every email used to be composed inline in English, whatever the recipient had
 * chosen in the app. A Portuguese seller wrote in about an order and got the
 * whole flow in English; the language was on their profile the entire time.
 *
 * Templates live in src/email-templates/<lang>/<name>.json and the engine falls
 * back to English per template, so a language that is missing one file degrades
 * to English for that email instead of failing to send.
 */

const { renderEmailTemplate, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } = require('./templateEngine');
const { sendEmail } = require('./emailService');
const logger = require('../utils/logger');

/**
 * The language to write to this recipient in.
 *
 * Accepts a Customer document, a lean object, or a bare language string so that
 * callers who only kept the language around do not have to refetch the profile.
 */
function recipientLanguage(recipient) {
  const raw = typeof recipient === 'string'
    ? recipient
    : recipient?.language || recipient?.preferences?.language;
  const code = String(raw || '').toLowerCase().slice(0, 2);
  return SUPPORTED_LANGUAGES.includes(code) ? code : DEFAULT_LANGUAGE;
}

/**
 * Render `templateName` in the recipient's language and send it to them.
 *
 * Never throws: a failed email must not roll back the transaction that caused
 * it. Returns true when the send was handed off, false when it was not.
 */
async function sendLocalizedEmail(recipient, templateName, data = {}) {
  const to = typeof recipient === 'string' ? null : recipient?.email;
  if (!to) {
    logger.warn(`[LocalizedEmail] No address for template "${templateName}" — skipped`);
    return false;
  }
  try {
    const language = recipientLanguage(recipient);
    const { subject, html } = renderEmailTemplate(templateName, language, data);
    await sendEmail(to, subject, html);
    return true;
  } catch (err) {
    logger.error(`[LocalizedEmail] Failed to send "${templateName}":`, err.message);
    return false;
  }
}

/** Date locale per app language — 2 October 2026 reads differently in each. */
const DATE_LOCALES = { en: 'en-GB', pt: 'pt-PT', es: 'es-ES', fr: 'fr-FR', de: 'de-DE' };

/**
 * A deadline written the way the recipient reads dates.
 *
 * Takes the same recipient as sendLocalizedEmail so a caller does not have to
 * resolve the language twice. Returns '' for a missing or invalid date, which
 * templates render as an empty slot rather than "Invalid Date".
 */
function formatEmailDate(date, recipient) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const locale = DATE_LOCALES[recipientLanguage(recipient)] || DATE_LOCALES[DEFAULT_LANGUAGE];
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

module.exports = { recipientLanguage, sendLocalizedEmail, formatEmailDate };
