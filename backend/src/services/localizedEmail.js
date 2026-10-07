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
    // `text` is the plain-text alternative. Every template has defined one from
    // the start, but no caller read it until now, so these emails went out
    // HTML-only — a deliverability penalty for a part that was already written.
    const { subject, html, text } = renderEmailTemplate(templateName, language, data);
    await sendEmail(to, subject, html, { text });
    return true;
  } catch (err) {
    logger.error(`[LocalizedEmail] Failed to send "${templateName}":`, err.message);
    return false;
  }
}

/**
 * The language an unauthenticated request is asking for, or null.
 *
 * Account verification and password reset are the only emails that can be sent
 * to an address with no profile behind it — at signup there is no Customer row
 * yet, so the browser's own Accept-Language is the only thing we know about the
 * person. Returns null rather than a default so the caller can tell "the
 * browser asked for Portuguese" apart from "we have no idea".
 */
function requestLanguage(req) {
  const header = req?.headers?.['accept-language'];
  if (!header || typeof header !== 'string') return null;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
      return { code: String(tag || '').toLowerCase().slice(0, 2), weight: q ? parseFloat(q.slice(2)) : 1 };
    })
    .filter(e => e.code && !Number.isNaN(e.weight) && e.weight > 0)
    // Browsers already send these in preference order, but the q-value is what
    // the header actually means, and sort is stable so ties keep header order.
    .sort((a, b) => b.weight - a.weight);

  for (const { code } of ranked) {
    if (SUPPORTED_LANGUAGES.includes(code)) return code;
  }
  return null;
}

/** Date locale per app language — 2 October 2026 reads differently in each. */
const DATE_LOCALES = { en: 'en-GB', pt: 'pt-PT', es: 'es-ES', fr: 'fr-FR', de: 'de-DE' };

/**
 * The BCP-47 locale to format anything in for this recipient.
 *
 * Numbers need it as much as dates do: €2,450 and €2.450 are the same amount
 * written for different readers, and a figure in a legal notice is the part that
 * must not be misread.
 */
function emailLocale(recipient) {
  return DATE_LOCALES[recipientLanguage(recipient)] || DATE_LOCALES[DEFAULT_LANGUAGE];
}

/**
 * A deadline written the way the recipient reads dates.
 *
 * Takes the same recipient as sendLocalizedEmail so a caller does not have to
 * resolve the language twice. Returns '' for a missing or invalid date, which
 * templates render as an empty slot rather than "Invalid Date".
 */
function formatEmailDate(date, recipient) {
  // Guard null/undefined before Date(): new Date(null) is the Unix epoch, not an
  // invalid date, so a transaction with no deadline would read "1 January 1970".
  if (date === null || date === undefined || date === '') return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const locale = emailLocale(recipient);
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * A deadline with a time on it, written the way the recipient reads one.
 *
 * Separate from formatEmailDate because a private-room invitation lives or dies
 * on the hour, and "October 5, 2026 at 09:00 PM" is not how a Portuguese reader
 * parses a deadline.
 */
function formatEmailDateTime(date, recipient) {
  if (date === null || date === undefined || date === '') return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const locale = emailLocale(recipient);
  return d.toLocaleString(locale, {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

/**
 * The handful of strings that live inside the layout helpers rather than in a
 * template: the uppercase label on a payout box, a ship-to card, an amount card.
 *
 * They belong here and not in the JSON templates because the markup around them
 * is built in code — duplicating that markup across four locale files per
 * template is how the labels would drift out of sync with the boxes.
 */
const BOX_LABELS = {
  shipTo: { en: 'Ship to', pt: 'Enviar para', es: 'Enviar a', fr: 'Expédier à' },
  payout: { en: 'Your payout', pt: 'O seu pagamento', es: 'Tu pago', fr: 'Votre versement' },
  offer: { en: 'Your offer', pt: 'A sua oferta', es: 'Tu oferta', fr: 'Votre offre' },
  amount: { en: 'Amount', pt: 'Valor', es: 'Importe', fr: 'Montant' },
  paymentReceived: {
    en: 'Payment received',
    pt: 'Pagamento recebido',
    es: 'Pago recibido',
    fr: 'Paiement reçu'
  },
  addedToBalance: {
    en: 'Added to your BidRoom balance',
    pt: 'Adicionado ao seu saldo BidRoom',
    es: 'Añadido a tu saldo de BidRoom',
    fr: 'Ajouté à votre solde BidRoom'
  },
  // The two figures in the DSA Article 29 notice. They are labels on a box the
  // scheduler builds, so they live here rather than in the template.
  dsaAnnualSales: {
    en: 'Annual sales',
    pt: 'Vendas anuais',
    es: 'Ventas anuales',
    fr: 'Ventes annuelles'
  },
  dsaAnnualTransactions: {
    en: 'Annual transactions',
    pt: 'Transacções anuais',
    es: 'Transacciones anuales',
    fr: 'Transactions annuelles'
  },
  dsaThreshold: { en: 'threshold', pt: 'limite', es: 'umbral', fr: 'seuil' },
  // Stripe usually names the requirement it rejected; when it sends an error
  // with neither a reason nor a code, the list would otherwise be empty.
  verificationIssueUnknown: {
    en: 'Stripe did not say which detail was rejected — check your payout account.',
    pt: 'O Stripe não indicou qual o dado rejeitado — verifique a sua conta de pagamentos.',
    es: 'Stripe no ha indicado qué dato ha rechazado: revisa tu cuenta de pagos.',
    fr: "Stripe n'a pas précisé la donnée refusée : vérifiez votre compte de versement."
  },

  // Stand-ins for a third party's name and an item's title when neither is on
  // file. These used to be the English literals 'Buyer' and 'your item' dropped
  // straight into a translated sentence, which read as a bug in the one email
  // where the seller is already upset.
  theBuyer: {
    en: 'the buyer',
    pt: 'o comprador',
    es: 'el comprador',
    fr: "l'acheteur"
  },
  yourItem: {
    en: 'your item',
    pt: 'o seu artigo',
    es: 'tu artículo',
    fr: 'votre article'
  }
};

/** The label for `key` in the recipient's language, falling back to English. */
function emailLabel(key, recipient) {
  const entry = BOX_LABELS[key];
  if (!entry) return '';
  return entry[recipientLanguage(recipient)] || entry[DEFAULT_LANGUAGE];
}

module.exports = {
  recipientLanguage,
  requestLanguage,
  sendLocalizedEmail,
  formatEmailDate,
  formatEmailDateTime,
  emailLocale,
  emailLabel
};
