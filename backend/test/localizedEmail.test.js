const { recipientLanguage, formatEmailDate } = require('../src/services/localizedEmail');
const { renderEmailTemplate } = require('../src/services/templateEngine');

const LANGUAGES = ['en', 'pt', 'es', 'fr'];

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
  orderCancelledSellerNoShip: { firstName: 'José Luís', listingTitle: 'Relógio Seiko', ctaUrl: 'https://x.pt' }
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
          expect(html).toContain(data.listingTitle);
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
