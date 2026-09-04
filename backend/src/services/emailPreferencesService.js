const crypto = require('crypto');
const Customer = require('../models/Customer');
const InterestedContact = require('../models/InterestedContact');

const MODELS_BY_TYPE = {
  customer: Customer,
  interested: InterestedContact
};

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL || 'https://www.bidroom.pt').replace(/\/$/, '');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Looks up the model + document for a recipient token/type pair. Returns null if invalid. */
async function findByToken(type, token) {
  const Model = MODELS_BY_TYPE[type];
  if (!Model || !token) return null;
  return Model.findOne({ emailUnsubscribeToken: token });
}

/**
 * Finds a contact by email. Prefers registered customers over interested contacts.
 * Returns { type, doc } or null.
 */
async function findByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) return null;

  const customer = await Customer.findOne({ email: normalized });
  if (customer) return { type: 'customer', doc: customer };

  const interested = await InterestedContact.findOne({ email: normalized });
  if (interested) return { type: 'interested', doc: interested };

  return null;
}

/** Returns the recipient's existing token, generating and persisting one lazily if missing. */
async function getOrCreateToken(type, id) {
  const Model = MODELS_BY_TYPE[type];
  if (!Model) return null;
  const doc = await Model.findById(id).select('emailUnsubscribeToken');
  if (!doc) return null;
  if (doc.emailUnsubscribeToken) return doc.emailUnsubscribeToken;
  const token = crypto.randomBytes(24).toString('hex');
  doc.emailUnsubscribeToken = token;
  await doc.save();
  return token;
}

/**
 * HTML footer appended to every email sent from the admin outreach tool, giving recipients a
 * self-service way to unsubscribe or change their preferred language without logging in.
 * Without a token, links to the public preferences page (email confirmation flow).
 */
function buildPreferencesFooter({ token, type, texts }) {
  const href = token
    ? `${frontendBaseUrl()}/email-preferences?token=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}`
    : `${frontendBaseUrl()}/email-preferences`;
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:32px;border-top:1px solid #e2e8f0;">
      <tr>
        <td style="padding:16px 0 0;text-align:center;font-size:12px;color:#64748b;line-height:1.6;">
          <a href="${href}" style="color:#2563eb;text-decoration:underline;">${texts.manage}</a>
        </td>
      </tr>
    </table>`;
}

const FOOTER_TEXTS = {
  pt: { manage: 'Cancelar subscrição ou alterar idioma' },
  en: { manage: 'Unsubscribe or change language' },
  es: { manage: 'Cancelar suscripción o cambiar idioma' },
  fr: { manage: 'Se désabonner ou changer de langue' }
};

/** Appends the self-service preferences footer to an email body for a given recipient. */
async function appendPreferencesFooter(html, { type, id, language }) {
  const texts = FOOTER_TEXTS[language] || FOOTER_TEXTS.en;
  const token = id ? await getOrCreateToken(type, id) : null;
  return html + buildPreferencesFooter({ token, type, texts });
}

module.exports = {
  findByToken,
  findByEmail,
  normalizeEmail,
  getOrCreateToken,
  appendPreferencesFooter,
  buildPreferencesFooter,
  FOOTER_TEXTS
};
