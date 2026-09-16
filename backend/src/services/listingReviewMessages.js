/**
 * In-app notification copy for the manual listing review, in every language the
 * platform offers.
 *
 * The rest of notificationService writes English inline. That is fine for text
 * nobody translates, but a seller is told here that their listing was refused
 * and what to do about it — reading that in a language they did not choose is
 * how a rejection turns into a support ticket. Emails already resolve language
 * per user (see email-templates/), so this only brings the in-app side level.
 *
 * `en` is the fallback: SUPPORTED mirrors Customer.language, and anything
 * outside it falls back rather than showing a blank notification.
 */

const DEFAULT_LANGUAGE = 'en';
const SUPPORTED = ['en', 'pt', 'es', 'fr'];

const MESSAGES = {
  approved: {
    en: {
      title: 'Listing approved',
      message: (title) => `"${title}" has been approved and is now live. The auction clock starts now.`
    },
    pt: {
      title: 'Anúncio aprovado',
      message: (title) => `"${title}" foi aprovado e já está publicado. O tempo do leilão começa agora.`
    },
    es: {
      title: 'Anuncio aprobado',
      message: (title) => `"${title}" ha sido aprobado y ya está publicado. El tiempo de la subasta empieza ahora.`
    },
    fr: {
      title: 'Annonce approuvée',
      message: (title) => `« ${title} » a été approuvée et est maintenant en ligne. Le compte à rebours de l'enchère démarre maintenant.`
    }
  },
  rejected: {
    en: {
      title: 'Listing not approved',
      message: (title, reason) =>
        `"${title}" was not approved.${reason ? ` Reason: ${reason}` : ''} You can edit it and submit it again.`
    },
    pt: {
      title: 'Anúncio não aprovado',
      message: (title, reason) =>
        `"${title}" não foi aprovado.${reason ? ` Motivo: ${reason}` : ''} Pode editá-lo e submetê-lo novamente.`
    },
    es: {
      title: 'Anuncio no aprobado',
      message: (title, reason) =>
        `"${title}" no ha sido aprobado.${reason ? ` Motivo: ${reason}` : ''} Puede editarlo y volver a enviarlo.`
    },
    fr: {
      title: 'Annonce non approuvée',
      message: (title, reason) =>
        `« ${title} » n'a pas été approuvée.${reason ? ` Motif : ${reason}` : ''} Vous pouvez la modifier et la soumettre à nouveau.`
    }
  }
};

/** Normalises anything (null, 'de', 'pt-PT') to a language we actually have copy for. */
function resolveLanguage(language) {
  const base = String(language || '').trim().toLowerCase().split('-')[0];
  return SUPPORTED.includes(base) ? base : DEFAULT_LANGUAGE;
}

/**
 * @param {'approved'|'rejected'} decision
 * @param {string} language - the seller's Customer.language
 * @param {string} listingTitle
 * @param {string|null} [reason] - admin's explanation, shown only on rejection
 * @returns {{title: string, message: string}}
 */
function reviewNotificationCopy(decision, language, listingTitle, reason = null) {
  const lang = resolveLanguage(language);
  const entry = MESSAGES[decision][lang];
  return {
    title: entry.title,
    message: entry.message(listingTitle, reason)
  };
}

module.exports = { reviewNotificationCopy, resolveLanguage, SUPPORTED, DEFAULT_LANGUAGE };
