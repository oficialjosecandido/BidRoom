/**
 * In-app notification copy for giveaways, in every language the platform
 * offers.
 *
 * Same reasoning as listingReviewMessages: this is copy a participant reads
 * about something that happened to them, and being told you won a prize in a
 * language you did not choose is a poor way to hear it. `en` is the fallback.
 */

const DEFAULT_LANGUAGE = 'en';
const SUPPORTED = ['en', 'pt', 'es', 'fr'];

/** Serial numbers are shown padded everywhere, so the copy matches the UI. */
function formatEntry(entryNumber) {
  return `#${String(entryNumber ?? 0).padStart(4, '0')}`;
}

const MESSAGES = {
  won: {
    en: {
      title: '🎉 You won the giveaway',
      message: (title, entry) =>
        `Your entry ${entry} was drawn for "${title}". We will be in touch about getting your prize to you.`
    },
    pt: {
      title: '🎉 Ganhou o passatempo',
      message: (title, entry) =>
        `A sua participação ${entry} foi sorteada em "${title}". Entraremos em contacto para lhe fazer chegar o prémio.`
    },
    es: {
      title: '🎉 Ha ganado el sorteo',
      message: (title, entry) =>
        `Su participación ${entry} ha sido la elegida en "${title}". Nos pondremos en contacto para hacerle llegar el premio.`
    },
    fr: {
      title: '🎉 Vous avez gagné le jeu-concours',
      message: (title, entry) =>
        `Votre participation ${entry} a été tirée au sort pour « ${title} ». Nous vous contacterons pour vous faire parvenir votre lot.`
    }
  },
  notWon: {
    en: {
      title: 'Giveaway result',
      message: (title, entry) =>
        `The winner of "${title}" has been drawn: entry ${entry}. Thanks for entering — the result is on the giveaway page.`
    },
    pt: {
      title: 'Resultado do passatempo',
      message: (title, entry) =>
        `O vencedor de "${title}" já foi sorteado: participação ${entry}. Obrigado por participar — o resultado está na página do passatempo.`
    },
    es: {
      title: 'Resultado del sorteo',
      message: (title, entry) =>
        `Ya se ha sorteado el ganador de "${title}": participación ${entry}. Gracias por participar — el resultado está en la página del sorteo.`
    },
    fr: {
      title: 'Résultat du jeu-concours',
      message: (title, entry) =>
        `Le gagnant de « ${title} » a été tiré au sort : participation ${entry}. Merci d'avoir participé — le résultat est sur la page du jeu-concours.`
    }
  },
  entered: {
    en: {
      title: "You're entered",
      message: (title, entry) =>
        `You are entered in "${title}" with entry ${entry}. It cost nothing and every entry has the same chance.`
    },
    pt: {
      title: 'Participação registada',
      message: (title, entry) =>
        `Está a participar em "${title}" com a participação ${entry}. Não custou nada e todas as participações têm a mesma probabilidade.`
    },
    es: {
      title: 'Participación registrada',
      message: (title, entry) =>
        `Participa en "${title}" con la participación ${entry}. No ha costado nada y todas las participaciones tienen la misma probabilidad.`
    },
    fr: {
      title: 'Participation enregistrée',
      message: (title, entry) =>
        `Vous participez à « ${title} » avec la participation ${entry}. C'était gratuit et chaque participation a la même chance.`
    }
  }
};

/** Normalises anything (null, 'de', 'pt-PT') to a language we actually have copy for. */
function resolveLanguage(language) {
  const base = String(language || '').trim().toLowerCase().split('-')[0];
  return SUPPORTED.includes(base) ? base : DEFAULT_LANGUAGE;
}

/**
 * @param {'won'|'notWon'|'entered'} event
 * @param {string} language - the participant's Customer.language
 * @param {string} listingTitle
 * @param {number} entryNumber - the entry this message is about
 * @returns {{title: string, message: string}}
 */
function giveawayNotificationCopy(event, language, listingTitle, entryNumber) {
  const entry = MESSAGES[event][resolveLanguage(language)];
  return {
    title: entry.title,
    message: entry.message(listingTitle, formatEntry(entryNumber))
  };
}

module.exports = {
  SUPPORTED,
  DEFAULT_LANGUAGE,
  formatEntry,
  resolveLanguage,
  giveawayNotificationCopy
};
