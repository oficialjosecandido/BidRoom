/**
 * In-app copy for "please leave a review" prompts, in every language BidRoom
 * offers. Same idea as listingReviewMessages / giveawayMessages: the reader
 * should see the item name and what to do, in their own language.
 */

const DEFAULT_LANGUAGE = 'en';
const SUPPORTED = ['en', 'pt', 'es', 'fr'];

function resolveLanguage(raw) {
  const code = String(raw || '').toLowerCase().slice(0, 2);
  return SUPPORTED.includes(code) ? code : DEFAULT_LANGUAGE;
}

const MESSAGES = {
  buyer: {
    en: {
      title: 'Rate the seller',
      message: (title) =>
        `How was your purchase of "${title}"? Leave a review for the seller — it helps other buyers.`
    },
    pt: {
      title: 'Avalie o vendedor',
      message: (title) =>
        `Como correu a compra de "${title}"? Deixe uma avaliação ao vendedor — ajuda outros compradores.`
    },
    es: {
      title: 'Valora al vendedor',
      message: (title) =>
        `¿Cómo fue tu compra de "${title}"? Deja una valoración al vendedor: ayuda a otros compradores.`
    },
    fr: {
      title: 'Évaluez le vendeur',
      message: (title) =>
        `Comment s'est passé votre achat de « ${title} » ? Laissez un avis sur le vendeur — cela aide les autres acheteurs.`
    }
  },
  seller: {
    en: {
      title: 'Rate the buyer',
      message: (title) =>
        `How did the sale of "${title}" go? Leave a review for the buyer — it helps other sellers.`
    },
    pt: {
      title: 'Avalie o comprador',
      message: (title) =>
        `Como correu a venda de "${title}"? Deixe uma avaliação ao comprador — ajuda outros vendedores.`
    },
    es: {
      title: 'Valora al comprador',
      message: (title) =>
        `¿Cómo fue la venta de "${title}"? Deja una valoración al comprador: ayuda a otros vendedores.`
    },
    fr: {
      title: 'Évaluez l\'acheteur',
      message: (title) =>
        `Comment s'est passée la vente de « ${title} » ? Laissez un avis sur l'acheteur — cela aide les autres vendeurs.`
    }
  }
};

const FALLBACK_TITLE = {
  en: 'this item',
  pt: 'este artigo',
  es: 'este artículo',
  fr: 'cet article'
};

/**
 * @param {'buyer'|'seller'} role
 * @param {string|null|undefined} language
 * @param {string|null|undefined} listingTitle
 */
function transactionReviewPromptCopy(role, language, listingTitle) {
  const lang = resolveLanguage(language);
  const roleKey = role === 'seller' ? 'seller' : 'buyer';
  const entry = MESSAGES[roleKey][lang] || MESSAGES[roleKey][DEFAULT_LANGUAGE];
  const titleText = String(listingTitle || '').trim() || FALLBACK_TITLE[lang] || FALLBACK_TITLE.en;
  return {
    title: entry.title,
    message: entry.message(titleText)
  };
}

module.exports = {
  transactionReviewPromptCopy,
  resolveLanguage,
  SUPPORTED,
  DEFAULT_LANGUAGE
};
