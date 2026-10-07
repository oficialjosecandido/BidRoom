const fs = require('fs');
const path = require('path');
const { recipientLanguage, requestLanguage, formatEmailDate } = require('../src/services/localizedEmail');
const { renderEmailTemplate } = require('../src/services/templateEngine');
const { emailStepsList, escapeHtml } = require('../src/utils/bidroomEmailLayout');

const LANGUAGES = ['en', 'pt', 'es', 'fr'];
const TEMPLATE_DIR = path.join(__dirname, '..', 'src', 'email-templates');

/** Every variable and conditional a template file declares. */
function declaredVariables(lang, name) {
  const raw = fs.readFileSync(path.join(TEMPLATE_DIR, lang, `${name}.json`), 'utf8');
  return new Set([
    // `{{else}}` matches the variable shape but is a block marker: counting it
    // would make a template that needs an else branch in one language and not
    // in another look like a variable-parity failure.
    ...[...raw.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).filter(v => v !== 'else'),
    ...[...raw.matchAll(/\{\{#if (\w+)\}\}/g)].map(m => m[1])
  ]);
}

const TEMPLATE_NAMES = fs.readdirSync(path.join(TEMPLATE_DIR, 'en'))
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace(/\.json$/, ''))
  .sort();

/**
 * Every template the sale flow sends, with the data its call site passes.
 * The engine leaves an unknown {{variable}} in the output verbatim, so this
 * doubles as the contract between each caller and its template.
 */
const SALE_FLOW = {
  paymentReceivedSeller: {
    sellerFirstName: 'José Luís',
    buyerName: 'José Cândido',
    listingTitle: 'Relógio Seiko',
    shipToBox: '<div>box</div>',
    shipToText: 'José Cândido\nRua das Flores 12',
    payoutBox: '<div>payout</div>',
    payoutLabel: '€198.00',
    ctaUrl: 'https://www.bidroom.pt/dashboard/transactions'
  },
  orderConfirmedBuyer: { firstName: 'Ana', listingTitle: 'Relógio Seiko', ctaUrl: 'https://x.pt' },
  orderShipped: {
    buyerFirstName: 'Ana',
    listingTitle: 'Relógio Seiko',
    trackingLine: 'CTT – RR123456789PT',
    proofUrl: 'https://x.pt/proof.pdf',
    ctaUrl: 'https://x.pt'
  },
  orderCompletedBuyer: { firstName: 'Ana', listingTitle: 'Relógio Seiko', ctaUrl: 'https://x.pt' },
  payoutReleasedSeller: {
    sellerFirstName: 'José Luís',
    listingTitle: 'Relógio Seiko',
    payoutBox: '<div>payout</div>',
    payoutLabel: '€198.00',
    ctaUrl: 'https://x.pt'
  },
  shipReminderSeller: {
    sellerFirstName: 'José Luís',
    listingTitle: 'Relógio Seiko',
    shipByDate: '5 de outubro de 2026',
    shipToBox: '<div>box</div>',
    shipToText: 'José Cândido\nRua das Flores 12',
    ctaUrl: 'https://x.pt'
  },
  returnRequestSeller: {
    firstName: 'José Luís',
    listingTitle: 'Relógio Seiko',
    returnReason: 'Não corresponde à descrição',
    reasonBox: '<div>reason</div>',
    ctaUrl: 'https://x.pt'
  },
  orderCancelledBuyerRefund: { firstName: 'Ana', listingTitle: 'Relógio Seiko', ctaUrl: 'https://x.pt' },
  orderCancelledSellerNoShip: { firstName: 'José Luís', listingTitle: 'Relógio Seiko', ctaUrl: 'https://x.pt' },
  emailVerification: {
    firstName: 'Ana',
    ctaUrl: 'https://www.bidroom.pt/auth/verify-email?oobCode=abc'
  },
  passwordReset: {
    firstName: 'Ana',
    ctaUrl: 'https://www.bidroom.pt/auth/reset-password?oobCode=abc'
  },
  offerAcceptedBuyer: {
    firstName: 'Ana',
    listingTitle: 'Relógio Seiko',
    amount: '€150.00',
    amountBox: '<div>amount</div>',
    ctaUrl: 'https://x.pt'
  },
  balanceToppedUp: {
    firstName: 'Ana',
    amount: '€50.00',
    amountBox: '<div>amount</div>',
    ctaUrl: 'https://x.pt/dashboard'
  }
};

/**
 * Everything the auction, offer, private-room, giveaway and moderation flows
 * send. These predate the bidroom layout and carry their own link variable —
 * listingUrl, paymentUrl, chooseWinnerUrl — rather than the layout's ctaUrl, so
 * they cannot be folded into SALE_FLOW above.
 *
 * Same contract role: the engine leaves an unknown {{variable}} in the output
 * verbatim, so a caller that forgets one ships "{{endDate}}" to a customer.
 */
const NOTIFICATION_FLOW = {
  auctionClosed: {
    bidderName: 'Ana',
    finalBid: '€150.00',
    listingTitle: 'Relógio Seiko',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  auctionNotSold: {
    sellerName: 'José Luís',
    listingTitle: 'Relógio Seiko',
    relistUrl: 'https://x.pt/relist'
  },
  bestOfferEnded: {
    sellerName: 'José Luís',
    listingTitle: 'Relógio Seiko',
    offerCount: '3',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  chooseWinner: {
    sellerName: 'José Luís',
    listingTitle: 'Relógio Seiko',
    finalBid: '€150.00',
    chooseWinnerUrl: 'https://x.pt/listing/relogio-seiko?chooseWinner=1'
  },
  createPrivateRoomNotification: {
    sellerName: 'José Luís',
    listingTitle: 'Relógio Seiko',
    finalBid: '€150.00',
    createPrivateRoomUrl: 'https://x.pt/listing/relogio-seiko'
  },
  disputeRefundBuyer: {
    buyerName: 'Ana',
    listingTitle: 'Relógio Seiko',
    refundAmount: '€150.00'
  },
  disputeRefundSeller: {
    sellerName: 'José Luís',
    listingTitle: 'Relógio Seiko',
    refundAmount: '€150.00'
  },
  draftReminder: {
    firstName: 'Ana',
    draftTitle: 'Relógio Seiko',
    resumeUrl: 'https://x.pt/sell/draft/abc'
  },
  firstBidPlaced: {
    bidderName: 'Ana',
    bidAmount: '€150.00',
    listingTitle: 'Relógio Seiko',
    auctionEndDate: '5 de outubro de 2026',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  giveawayEntered: {
    firstName: 'Ana',
    listingTitle: 'Relógio Seiko',
    listingTitlePlain: 'Relógio Seiko',
    entryNumber: '42',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  giveawayWon: {
    firstName: 'Ana',
    listingTitle: 'Relógio Seiko',
    listingTitlePlain: 'Relógio Seiko',
    entryNumber: '42',
    totalEntries: '318',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  listingApproved: {
    firstName: 'José Luís',
    listingTitle: 'Relógio Seiko',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  listingRejected: {
    firstName: 'José Luís',
    listingTitle: 'Relógio Seiko',
    reason: 'Fotografias insuficientes',
    dashboardUrl: 'https://x.pt/dashboard'
  },
  offerPlaced: {
    offererName: 'Ana',
    offerAmount: '€150.00',
    listingTitle: 'Relógio Seiko',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  offerOutbid: {
    offererName: 'Ana',
    previousOffer: '€150.00',
    newOffer: '€165.00',
    listingTitle: 'Relógio Seiko',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  outbid: {
    bidderName: 'Ana',
    previousBid: '€150.00',
    newBid: '€165.00',
    listingTitle: 'Relógio Seiko',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  platinumBidderInvitation: {
    bidderName: 'Ana',
    listingTitle: 'Relógio Seiko',
    currentPrice: '150.00',
    endDate: '5 de outubro de 2026, 21:00',
    acceptInvitationUrl: 'https://x.pt/private-room/accept/tok',
    declineInvitationUrl: 'https://x.pt/private-room/decline/tok'
  },
  privateRoomOpenInvited: {
    bidderName: 'Ana',
    listingTitle: 'Relógio Seiko',
    currentPrice: '150.00',
    endDate: '5 de outubro de 2026, 21:00',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  privateRoomClosedNoAcceptanceInvited: {
    bidderName: 'Ana',
    listingTitle: 'Relógio Seiko',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  privateRoomClosedNoAcceptanceSeller: {
    sellerName: 'José Luís',
    listingTitle: 'Relógio Seiko',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  privateRoomClosedSellerLeftBuyers: {
    bidderName: 'Ana',
    listingTitle: 'Relógio Seiko',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  privateRoomClosedSellerLeftSeller: {
    sellerName: 'José Luís',
    listingTitle: 'Relógio Seiko',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  privateRoomNotInvited: {
    bidderName: 'Ana',
    listingTitle: 'Relógio Seiko',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  privateRoomNotWinner: {
    bidderName: 'Ana',
    listingTitle: 'Relógio Seiko',
    finalBid: '€165.00',
    listingUrl: 'https://x.pt/listing/relogio-seiko'
  },
  privateRoomWinner: {
    winnerName: 'Ana',
    listingTitle: 'Relógio Seiko',
    winningBid: '€165.00',
    paymentUrl: 'https://x.pt/checkout/abc'
  },
  youWon: {
    winnerName: 'Ana',
    listingTitle: 'Relógio Seiko',
    winningBid: '€165.00',
    paymentUrl: 'https://x.pt/checkout/abc'
  },
  supportReply: {
    firstName: 'Ana',
    subjectLabel: 'Envio do Relógio Seiko',
    preview: 'Respondemos ao seu pedido.',
    ctaUrl: 'https://x.pt/support/thread/abc'
  },
  payoutAccountVerified: {
    firstName: 'José Luís',
    ctaUrl: 'https://x.pt/dashboard/seller'
  },
  // `isFinalReminder` drives an {{#if}}…{{else}}…{{/if}}: false here so the
  // fixture exercises the else branch, which is the one the engine used to
  // drop on the floor along with the rest of the paragraph.
  confirmReceiptBuyer: {
    firstName: 'Margarida',
    listingTitle: 'Relógio Seiko',
    isFinalReminder: false,
    autoReleaseDate: '14 de Outubro de 2026',
    ctaUrl: 'https://x.pt/dashboard/transactions'
  },
  disputeOpenedSeller: {
    firstName: 'José Luís',
    buyerName: 'Margarida Almeida',
    itemTitle: 'Relógio Seiko',
    ctaUrl: 'https://x.pt/dashboard/transactions'
  },
  dsaSellerStatusWarning: {
    firstName: 'José Luís',
    statsBox: '<table><tr><td>Vendas anuais: €2.450 (limite: €2.000)</td></tr></table>',
    statsText: '- Vendas anuais: €2.450 (limite: €2.000)',
    graceDays: '30',
    ctaUrl: 'https://x.pt/dashboard/home'
  },
  payoutAccountIssue: {
    firstName: 'José Luís',
    // Stripe's own English wording — passed through, never translated.
    issuesBox: '<table><tr><td>Please upload a valid photo ID.</td></tr></table>',
    issuesText: '- Please upload a valid photo ID.',
    ctaUrl: 'https://x.pt/dashboard/settings'
  }
};

describe('recipientLanguage', () => {
  it('reads the language off a Customer document', () => {
    expect(recipientLanguage({ language: 'pt' })).toBe('pt');
    expect(recipientLanguage({ preferences: { language: 'fr' } })).toBe('fr');
  });

  it('accepts a bare language code', () => {
    expect(recipientLanguage('es')).toBe('es');
  });

  // The picker stores 'pt', but a browser or an import can hand us 'pt-PT'.
  it('narrows a regional tag to its base language', () => {
    expect(recipientLanguage({ language: 'pt-PT' })).toBe('pt');
    expect(recipientLanguage({ language: 'EN-GB' })).toBe('en');
  });

  it('falls back to English for anything it does not serve', () => {
    expect(recipientLanguage({ language: 'ja' })).toBe('en');
    expect(recipientLanguage({})).toBe('en');
    expect(recipientLanguage(null)).toBe('en');
    expect(recipientLanguage({ language: '' })).toBe('en');
  });
});

describe('formatEmailDate', () => {
  const date = new Date('2026-10-05T12:00:00Z');

  it('writes the date the way the recipient reads dates', () => {
    expect(formatEmailDate(date, 'pt')).toContain('outubro');
    expect(formatEmailDate(date, 'fr')).toContain('octobre');
    expect(formatEmailDate(date, 'en')).toContain('October');
  });

  // A transaction with no deadline must not put "Invalid Date" in an email.
  it('returns an empty string for a missing or unparseable date', () => {
    expect(formatEmailDate(null, 'pt')).toBe('');
    expect(formatEmailDate('not a date', 'pt')).toBe('');
    expect(formatEmailDate(undefined, 'pt')).toBe('');
  });
});

describe('sale-flow templates', () => {
  for (const [name, data] of Object.entries(SALE_FLOW)) {
    describe(name, () => {
      for (const lang of LANGUAGES) {
        it(`renders in ${lang} with nothing left unsubstituted`, () => {
          const { subject, html } = renderEmailTemplate(name, lang, data);

          expect(subject).toBeTruthy();
          expect(subject).not.toMatch(/\{\{|\}\}/);
          expect(html).not.toMatch(/\{\{|\}\}/);
          expect(html).toContain(data.ctaUrl);
          if (data.listingTitle) expect(html).toContain(data.listingTitle);
        });
      }

      it('is not silently falling back to English', () => {
        const en = renderEmailTemplate(name, 'en', data).subject;
        for (const lang of LANGUAGES.filter(l => l !== 'en')) {
          expect(renderEmailTemplate(name, lang, data).subject).not.toBe(en);
        }
      });
    });
  }
});

describe('notification templates', () => {
  for (const [name, data] of Object.entries(NOTIFICATION_FLOW)) {
    describe(name, () => {
      for (const lang of LANGUAGES) {
        it(`renders in ${lang} with nothing left unsubstituted`, () => {
          const { subject, html } = renderEmailTemplate(name, lang, data);

          expect(subject).toBeTruthy();
          expect(subject).not.toMatch(/\{\{|\}\}/);
          expect(html).not.toMatch(/\{\{|\}\}/);
          if (data.listingTitle) expect(html).toContain(data.listingTitle);

          // Every link the caller passes has to reach the markup. A translation
          // that drops one leaves a button pointing at nothing.
          for (const value of Object.values(data)) {
            // Not every fixture value is a string: a flag driving an {{#if}}
            // is a boolean, and asking it for startsWith threw.
            if (typeof value === 'string' && value.startsWith('https://')) {
              expect(html).toContain(value);
            }
          }
        });
      }

      it('is not silently falling back to English', () => {
        const en = renderEmailTemplate(name, 'en', data).subject;
        for (const lang of LANGUAGES.filter(l => l !== 'en')) {
          expect(renderEmailTemplate(name, lang, data).subject).not.toBe(en);
        }
      });
    });
  }
});

describe('template coverage', () => {
  // es/fr firstBidPlaced sat in the tree for months holding the boilerplate
  // example the family was copied from — "This is an example email template",
  // with {{recipientName}} and {{variableName}} that no sender passes. It
  // rendered, it sent, and nothing above would have caught it: the file existed,
  // so the engine never fell back to English. Comparing each translation's
  // variables against the English one is what catches a file like that.
  it('declares the same variables in every language', () => {
    for (const name of TEMPLATE_NAMES) {
      const en = [...declaredVariables('en', name)].sort();
      for (const lang of LANGUAGES.filter(l => l !== 'en')) {
        expect([...declaredVariables(lang, name)].sort()).toEqual(en);
      }
    }
  });

  it('has a translation of every template in every language', () => {
    for (const lang of LANGUAGES.filter(l => l !== 'en')) {
      for (const name of TEMPLATE_NAMES) {
        expect(fs.existsSync(path.join(TEMPLATE_DIR, lang, `${name}.json`))).toBe(true);
      }
    }
  });

  // Eleven senders passed `escapeHtml(x.firstName) || 'there'`, and escapeHtml
  // returns '' for undefined, so a buyer with no first name on file really did
  // get "Olá there,". The greeting has to be conditional in the template, which
  // is the only place that knows how to drop a name in that language.
  it('greets cleanly when the name is empty', () => {
    // Asserted against the render, not the source. Scanning the source for
    // `Olá {{var}},` missed the shape three templates actually used — the name
    // bolded, `Olá <strong …>{{offererName}}</strong>,` — which rendered as "Olá "
    // with a dangling space, no comma and an empty <strong> left behind. The
    // rendered greeting is the contract; how a template spells it is not.
    //
    // English uses both openings, and Spanish may close the line with a colon,
    // which is the correct letter form there.
    const OPENINGS = { en: ['Hi', 'Hello'], pt: ['Olá'], es: ['Hola'], fr: ['Bonjour'] };
    const bad = [];

    for (const name of TEMPLATE_NAMES) {
      const raw = fs.readFileSync(path.join(TEMPLATE_DIR, 'en', `${name}.json`), 'utf8');
      const vars = [...new Set([...raw.matchAll(/\{\{#?if?\s*(\w+)\}\}/g)].map(m => m[1]))];
      // Every variable empty: an undefined one would ship as literal `{{var}}`.
      const data = Object.fromEntries(vars.map(v => [v, '']));

      for (const lang of LANGUAGES) {
        const { html } = renderEmailTemplate(name, lang, data);
        // Only whole text nodes, because the greeting word hides inside real
        // headings too — offerOutbid's English title is "Higher offer received".
        const nodes = [...html.matchAll(/>([^<>]+)</g)].map(m => m[1].trim());
        const opens = new RegExp(`^(${OPENINGS[lang].join('|')})`);
        const greetings = nodes.filter(t => opens.test(t) && t.length < 20);

        if (!greetings.some(t => /[,:]$/.test(t))) {
          bad.push(`${lang}/${name}: ${JSON.stringify(greetings)}`);
        }
      }
    }

    expect(bad).toEqual([]);
  });

  // Without this, a new template can be added with no test behind it and the
  // suite stays green.
  it('exercises every template that exists', () => {
    const tested = [...Object.keys(SALE_FLOW), ...Object.keys(NOTIFICATION_FLOW)].sort();
    expect(tested).toEqual(TEMPLATE_NAMES);
  });
});

describe('requestLanguage', () => {
  const req = (header) => ({ headers: header === undefined ? {} : { 'accept-language': header } });

  it('reads the language a browser asks for', () => {
    expect(requestLanguage(req('pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7'))).toBe('pt');
    expect(requestLanguage(req('fr-FR,fr;q=0.9'))).toBe('fr');
  });

  // Chrome sends the preferred language first, but the q-value is what the
  // header actually means and nothing stops a client from ordering it otherwise.
  it('honours the q-value over the header order', () => {
    expect(requestLanguage(req('en;q=0.3,pt;q=0.9'))).toBe('pt');
  });

  it('skips languages BidRoom does not serve', () => {
    expect(requestLanguage(req('ja,ko;q=0.9,es;q=0.5'))).toBe('es');
  });

  // null, not a default: the caller has to be able to tell "no idea" apart from
  // "asked for English", because that decides whether a profile can be overruled.
  it('returns null when there is nothing to go on', () => {
    expect(requestLanguage(req('ja,ko;q=0.9'))).toBeNull();
    expect(requestLanguage(req(''))).toBeNull();
    expect(requestLanguage(req())).toBeNull();
    expect(requestLanguage(null)).toBeNull();
  });
});

describe('name-optional greetings', () => {
  // Verification and reset can go to an address with no profile behind it, so
  // there is no name to greet and no translation for "there".
  it('drops the name from the greeting rather than leaving a gap', () => {
    for (const name of ['emailVerification', 'passwordReset']) {
      const { html } = renderEmailTemplate(name, 'pt', { firstName: '', ctaUrl: 'https://x.pt' });
      expect(html).toContain('Olá,');
      expect(html).not.toMatch(/\{\{|\}\}/);
    }
  });

  it('greets by name when there is one', () => {
    const { html } = renderEmailTemplate('passwordReset', 'pt', { firstName: 'Ana', ctaUrl: 'https://x.pt' });
    expect(html).toContain('Olá Ana,');
  });
});

describe('emailLabel', () => {
  const { emailLabel } = require('../src/services/localizedEmail');

  it('translates the labels baked into the layout helpers', () => {
    expect(emailLabel('shipTo', { language: 'pt' })).toBe('Enviar para');
    expect(emailLabel('payout', { language: 'fr' })).toBe('Votre versement');
    expect(emailLabel('offer', { language: 'es' })).toBe('Tu oferta');
  });

  it('falls back to English rather than to nothing', () => {
    expect(emailLabel('payout', { language: 'ja' })).toBe('Your payout');
    expect(emailLabel('payout', null)).toBe('Your payout');
  });

  it('returns an empty string for a key it does not know', () => {
    expect(emailLabel('nope', { language: 'pt' })).toBe('');
  });
});

describe('html lang attribute', () => {
  // A Portuguese email that declares lang="en" gets read aloud as English and
  // offered for translation into the language it is already in.
  it('declares the language the email is actually written in', () => {
    const data = SALE_FLOW.orderConfirmedBuyer;
    expect(renderEmailTemplate('orderConfirmedBuyer', 'pt', data).html).toContain('<html lang="pt">');
    expect(renderEmailTemplate('orderConfirmedBuyer', 'fr', data).html).toContain('<html lang="fr">');
    expect(renderEmailTemplate('orderConfirmedBuyer', 'en', data).html).toContain('<html lang="en">');
  });
});

describe('private-room invitation conditionals', () => {
  // Both fire in production: a bidder who signed up with an email and never
  // filled in a name, and a room whose closing time is not scheduled yet.
  // Before the conditionals the first was greeted "Hello Bidder" and the second
  // got the English literal "After 15-min acceptance window" as its date.
  for (const name of ['platinumBidderInvitation', 'privateRoomOpenInvited']) {
    it(`${name} drops the name and the date when neither is known`, () => {
      const data = { ...NOTIFICATION_FLOW[name], bidderName: '', endDate: '' };

      for (const lang of LANGUAGES) {
        const { html } = renderEmailTemplate(name, lang, data);
        expect(html).not.toMatch(/\{\{|\}\}/);
        expect(html).toContain(data.listingTitle);
      }
      expect(renderEmailTemplate(name, 'pt', data).html).toContain('Olá,');
    });
  }

  // The English template carried ${{currentPrice}} while every other price on
  // the platform is in euros.
  it('prices the room in euros, not dollars', () => {
    for (const name of ['platinumBidderInvitation', 'privateRoomOpenInvited']) {
      for (const lang of LANGUAGES) {
        const { html } = renderEmailTemplate(name, lang, NOTIFICATION_FLOW[name]);
        expect(html).toContain('€150.00');
        expect(html).not.toContain('$150.00');
      }
    }
  });
});

describe('draftReminder conditional', () => {
  // A draft saved before the title field is filled in has no title to name.
  it('drops the title when the draft has none', () => {
    for (const lang of LANGUAGES) {
      const { html } = renderEmailTemplate('draftReminder', lang, {
        firstName: 'Ana',
        draftTitle: '',
        resumeUrl: 'https://x.pt/sell/draft/abc'
      });
      expect(html).not.toMatch(/\{\{|\}\}/);
      expect(html).toContain('https://x.pt/sell/draft/abc');
    }
  });
});

describe('payout account emails', () => {
  // These two were the last emails composed inline in English, and the profile
  // they were sent from was loaded with `language` left out of the projection,
  // so neither the old nor a templated version would have reached the seller in
  // their own language. Both halves of that are worth holding down.
  const GREETINGS = { en: 'Hi', pt: 'Olá', es: 'Hola', fr: 'Bonjour' };

  it('greets without a name rather than with an English one', () => {
    // escapeHtml(undefined) is '', so the old `|| 'there'` genuinely shipped the
    // English word into a Portuguese email. The conditional drops the name slot.
    for (const name of ['payoutAccountVerified', 'payoutAccountIssue']) {
      for (const lang of LANGUAGES) {
        const { html } = renderEmailTemplate(name, lang, {
          firstName: '',
          issuesBox: '',
          issuesText: '',
          ctaUrl: 'https://x.pt/dashboard/settings'
        });
        expect(html).toContain(`${GREETINGS[lang]},`);
        expect(html).not.toContain('there,');
        expect(html).not.toMatch(/\{\{|\}\}/);
      }
    }
  });

  it('escapes the reasons Stripe sends and keeps them readable', () => {
    // e.reason comes from an external API into the template's markup raw.
    const reasons = ['Address <script>alert(1)</script> invalid', 'Upload a valid photo ID'];
    const box = emailStepsList(reasons.map(escapeHtml));

    for (const lang of LANGUAGES) {
      const { html } = renderEmailTemplate('payoutAccountIssue', lang, {
        firstName: 'José Luís',
        issuesBox: box,
        issuesText: reasons.map(r => `- ${r}`).join('\n'),
        ctaUrl: 'https://x.pt/dashboard/settings'
      });

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('Upload a valid photo ID');
    }
  });

  it('tells every non-English reader that the reasons are in English', () => {
    // Stripe writes them and only in English, so the caveat has to be there or
    // the list reads as a translation failure.
    for (const lang of ['pt', 'es', 'fr']) {
      const { html } = renderEmailTemplate('payoutAccountIssue', lang, {
        firstName: 'Ana',
        issuesBox: '',
        issuesText: '',
        ctaUrl: 'https://x.pt/dashboard/settings'
      });
      expect(html.toLowerCase()).toMatch(/ingl[êés]s|anglais/);
    }
  });
});

describe('DSA Article 29 notice', () => {
  // This one starts a 30-day clock before an account is flagged, which makes it
  // the worst email in the system to send in a language the seller cannot read.
  const { emailLocale, emailLabel } = require('../src/services/localizedEmail');

  it('writes the figures the way each language writes them', () => {
    // An English reader parses "12,450" as twelve thousand; a Portuguese or
    // French one reads a comma as the decimal mark, so the same string would be
    // twelve. The figure is the part of a legal notice that must not be misread.
    //
    // The separator itself is asserted by what it is *not*: pt-PT and fr-FR use
    // a narrow no-break space whose exact codepoint has moved between ICU
    // versions, so pinning it would break on a Node upgrade rather than on a bug.
    expect((12450).toLocaleString(emailLocale({ language: 'en' }))).toBe('12,450');
    for (const lang of ['pt', 'fr']) {
      expect((12450).toLocaleString(emailLocale({ language: lang }))).not.toContain(',');
    }
    expect((12450).toLocaleString(emailLocale({ language: 'es' }))).toBe('12.450');

    // An unknown language must not silently become the host's locale.
    expect(emailLocale({ language: 'zz' })).toBe(emailLocale({ language: 'en' }));
  });

  it('labels both thresholds in every language', () => {
    for (const key of ['dsaAnnualSales', 'dsaAnnualTransactions', 'dsaThreshold']) {
      const seen = new Set();
      for (const lang of LANGUAGES) {
        const label = emailLabel(key, { language: lang });
        expect(label).toBeTruthy();
        seen.add(label);
      }
      // Four distinct labels, or one of them is quietly falling back to English.
      expect(seen.size).toBe(LANGUAGES.length);
    }
  });

  it('cites the regulation verbatim in every language', () => {
    // The reference is what makes the notice compliant; translating the number
    // would break it.
    for (const lang of LANGUAGES) {
      const { html } = renderEmailTemplate('dsaSellerStatusWarning', lang, {
        firstName: 'Ana',
        statsBox: '',
        statsText: '',
        graceDays: '30',
        ctaUrl: 'https://x.pt/dashboard/home'
      });
      expect(html).toContain('2022/2065');
      expect(html).toContain('29');
      expect(html).toContain('30');
      expect(html).not.toMatch(/\{\{|\}\}/);
    }
  });
});

describe('orderShipped conditionals', () => {
  // The seller may ship with no tracking number at all — the whole block has to
  // disappear rather than render an empty "Tracking:" box.
  it('drops the tracking and proof blocks when there is nothing to show', () => {
    const { html } = renderEmailTemplate('orderShipped', 'pt', {
      buyerFirstName: 'Ana',
      listingTitle: 'Relógio Seiko',
      trackingLine: '',
      proofUrl: '',
      ctaUrl: 'https://x.pt'
    });

    expect(html).not.toContain('Número de registo');
    expect(html).not.toContain('comprovativo');
    expect(html).not.toMatch(/\{\{|\}\}/);
  });

  it('keeps them when the seller provided them', () => {
    const { html } = renderEmailTemplate('orderShipped', 'pt', {
      buyerFirstName: 'Ana',
      listingTitle: 'Relógio Seiko',
      trackingLine: 'CTT – RR123456789PT',
      proofUrl: 'https://x.pt/proof.pdf',
      ctaUrl: 'https://x.pt'
    });

    expect(html).toContain('Número de registo');
    expect(html).toContain('RR123456789PT');
    expect(html).toContain('https://x.pt/proof.pdf');
  });
});

describe('dispute opened notice', () => {
  const { emailLabel } = require('../src/services/localizedEmail');

  // This replaced an inline-English block. It asks the seller to upload
  // counter-evidence against a clock, so a seller who cannot read it loses the
  // dispute by default — the one email where language is not cosmetic.
  it('reaches the seller in their own language', () => {
    const open = { pt: 'disputa', es: 'disputa', fr: 'litige', en: 'dispute' };

    for (const lang of LANGUAGES) {
      const { subject, html } = renderEmailTemplate('disputeOpenedSeller', lang, {
        firstName: 'José Luís',
        buyerName: 'Margarida Almeida',
        itemTitle: 'Relógio Seiko',
        ctaUrl: 'https://x.pt/dashboard/transactions'
      });

      expect(subject.toLowerCase()).toContain(open[lang]);
      expect(html).toContain('Margarida Almeida');
      expect(html).toContain('Relógio Seiko');
      expect(html).toContain('https://x.pt/dashboard/transactions');
      expect(html).not.toMatch(/\{\{|\}\}/);
    }
  });

  // The buyer's name and the item's title are typed by users and substituted raw.
  it('escapes the buyer name and item title', () => {
    const { html } = renderEmailTemplate('disputeOpenedSeller', 'pt', {
      firstName: '',
      buyerName: escapeHtml('<script>x</script>'),
      itemTitle: escapeHtml('Relógio "A" & <b>B</b>'),
      ctaUrl: 'https://x.pt'
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('Olá,');
  });

  // The call site reaches for these when the buyer has no name on file or the
  // listing has no title. They used to be the literals 'Buyer' and 'your item',
  // which landed mid-sentence in a Portuguese email.
  it('has a localized stand-in for a missing name or title', () => {
    for (const lang of LANGUAGES) {
      const recipient = { language: lang };
      const buyer = emailLabel('theBuyer', recipient);
      const item = emailLabel('yourItem', recipient);

      expect(buyer).toBeTruthy();
      expect(item).toBeTruthy();
      if (lang !== 'en') {
        expect(buyer).not.toBe('the buyer');
        expect(item).not.toBe('your item');
      }
    }
  });
});

describe('conditional blocks', () => {
  const { renderTemplate } = require('../src/services/templateEngine');

  // The engine knew `{{#if}}…{{/if}}` but not `{{else}}`, so the whole if/else
  // was one body: a truthy value shipped BOTH branches with a literal
  // `{{else}}` between them, and a falsy one dropped the paragraph entirely.
  // confirmReceiptBuyer is the template that hit this, and it is the email that
  // asks a buyer to act against an auto-release clock.
  it('keeps only the taken branch', () => {
    const tpl = 'Olá, {{#if final}}último aviso{{else}}um aviso{{/if}}.';
    expect(renderTemplate(tpl, { final: true })).toBe('Olá, último aviso.');
    expect(renderTemplate(tpl, { final: false })).toBe('Olá, um aviso.');
  });

  it('leaves no marker behind in either branch', () => {
    const tpl = '{{#if x}}sim{{else}}não{{/if}}';
    for (const data of [{ x: true }, { x: false }, {}]) {
      expect(renderTemplate(tpl, data)).not.toMatch(/\{\{|\}\}/);
    }
  });

  it('drops the block when the condition is absent, with no else', () => {
    expect(renderTemplate('Olá{{#if firstName}} {{firstName}}{{/if}},', {}))
      .toBe('Olá,');
    expect(renderTemplate('Olá{{#if firstName}} {{firstName}}{{/if}},', { firstName: 'Ana' }))
      .toBe('Olá Ana,');
  });

  it('substitutes variables inside the branch it keeps', () => {
    const tpl = '{{#if autoReleaseDate}}Conclui a {{autoReleaseDate}}.{{else}}Sem prazo.{{/if}}';
    expect(renderTemplate(tpl, { autoReleaseDate: '14 de Outubro de 2026' }))
      .toBe('Conclui a 14 de Outubro de 2026.');
    expect(renderTemplate(tpl, { autoReleaseDate: '' })).toBe('Sem prazo.');
  });

  it('handles two blocks in one string without swallowing what lies between', () => {
    const tpl = '{{#if a}}A{{else}}a{{/if}}-meio-{{#if b}}B{{else}}b{{/if}}';
    expect(renderTemplate(tpl, { a: true, b: false })).toBe('A-meio-b');
  });

  it('renders both branches of confirmReceiptBuyer in every language', () => {
    for (const lang of LANGUAGES) {
      for (const isFinalReminder of [true, false]) {
        const { html, text } = renderEmailTemplate('confirmReceiptBuyer', lang, {
          ...NOTIFICATION_FLOW.confirmReceiptBuyer,
          isFinalReminder
        });
        expect(html).not.toMatch(/\{\{|\}\}/);
        expect(text).not.toMatch(/\{\{|\}\}/);
      }
    }
  });
});

describe('plain-text alternative', () => {
  const { htmlToText } = require('../src/services/emailService');

  // Every template has authored a `text` since the beginning, but no caller read
  // it and mailOptions had no `text` key, so every BidRoom email went out
  // HTML-only — 43 templates × 4 languages of plain text rendered and discarded.
  it('is populated for every template in every language', () => {
    const empty = [];

    for (const name of TEMPLATE_NAMES) {
      const data = { ...SALE_FLOW, ...NOTIFICATION_FLOW }[name];
      for (const lang of LANGUAGES) {
        const { text } = renderEmailTemplate(name, lang, data);
        if (!text || !text.trim()) empty.push(`${lang}/${name}`);
        // A variable left unsubstituted is as wrong in the text part as in the
        // HTML one — it just was not visible while nothing sent it.
        else if (/\{\{|\}\}/.test(text)) empty.push(`${lang}/${name}: unsubstituted`);
      }
    }

    expect(empty).toEqual([]);
  });

  it('carries no markup', () => {
    for (const name of TEMPLATE_NAMES) {
      const data = { ...SALE_FLOW, ...NOTIFICATION_FLOW }[name];
      const { text } = renderEmailTemplate(name, 'pt', data);
      expect(text).not.toMatch(/<(p|div|table|strong|a)\b/);
    }
  });

  describe('derived from HTML, for senders that author no text', () => {
    it('keeps each link reachable', () => {
      const out = htmlToText('<a href="https://bidroom.pt/x" style="color:red">Ver no painel</a>');
      // "Ver no painel" alone is useless without the address behind it.
      expect(out).toBe('Ver no painel (https://bidroom.pt/x)');
    });

    it('decodes the entities BidRoom writes prices with', () => {
      expect(htmlToText('<p>150&nbsp;&euro; &amp; final &#8212; ok &#x2713;</p>'))
        .toBe('150 € & final — ok ✓');
    });

    it('separates table cells and list items', () => {
      expect(htmlToText('<table><tr><td>Lance actual</td><td>&euro;150</td></tr></table>'))
        .toBe('Lance actual\t€150');
      expect(htmlToText('<ul><li>Um</li><li>Dois</li></ul>')).toBe('- Um\n- Dois');
    });

    it('drops markup that is not prose', () => {
      const out = htmlToText('<style>.a{color:red}</style><script>x()</script><p>Olá</p>');
      expect(out).toBe('Olá');
    });

    it('returns an empty string rather than throwing on nothing', () => {
      // sendEmail only sets mailOptions.text when this is non-empty: an empty
      // text part is worse than none, because a client may prefer it and show a
      // blank message.
      expect(htmlToText('')).toBe('');
      expect(htmlToText(undefined)).toBe('');
      expect(htmlToText('<div><span></span></div>')).toBe('');
    });
  });
});
