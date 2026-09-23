jest.mock('../src/models/Listing', () => ({ find: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../src/utils/publicUrls', () => ({ publicBaseUrl: () => 'https://www.bidroom.pt' }));

const Listing = require('../src/models/Listing');
const {
  pickFeaturedAuctions,
  pickActiveGiveaway,
  renderAuctionsBlock,
  renderGiveawayBlock,
  expandAuctionPlaceholders,
  expandGiveawayPlaceholders,
  expandCampaignContent,
  hasAuctionPlaceholder,
  hasGiveawayPlaceholder,
  localizedTitle,
  categoryLabel,
  formatPrice
} = require('../src/services/newsletterService');

const NOW = new Date('2026-09-23T10:00:00.000Z');
const inDays = d => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);

const BLOB = 'https://acct.blob.core.windows.net/listing-images/';
const PLACEHOLDER_IMG = 'https://via.placeholder.com/400x300?text=No+Image';

let autoId = 0;
function listing(overrides = {}) {
  autoId += 1;
  return {
    _id: `id${autoId}`,
    slug: `slug-${autoId}`,
    category: 'art',
    images: [`${BLOB}photo-${autoId}.jpg`],
    startingPrice: 100,
    currentPrice: 100,
    bidCount: 0,
    viewCount: 0,
    auctionFormat: 'highest-bid',
    endDate: inDays(3),
    createdAt: inDays(-1),
    titlePt: `Peça ${autoId}`,
    ...overrides
  };
}

function giveawayDoc(overrides = {}) {
  autoId += 1;
  return {
    _id: `gid${autoId}`,
    slug: `giveaway-${autoId}`,
    category: 'jewelry',
    images: [`${BLOB}giveaway-${autoId}.jpg`],
    endDate: inDays(5),
    giveaway: { entryCount: 0 },
    titlePt: `Passatempo ${autoId}`,
    ...overrides
  };
}

/**
 * Listing.find(...).sort(...).limit(...).lean()
 *
 * Auctions and giveaways come from the same collection, so the stub answers by
 * `saleFormat` — otherwise the giveaway query would be handed auction docs.
 */
function mockCandidates(docs, giveaways = []) {
  Listing.find.mockImplementation(filter => {
    const rows = filter?.saleFormat === 'giveaway' ? giveaways : docs;
    return { sort: () => ({ limit: () => ({ lean: async () => rows }) }) };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  autoId = 0;
});

describe('pickFeaturedAuctions', () => {
  it('only asks for auctions that are open right now', async () => {
    mockCandidates([]);
    await pickFeaturedAuctions({ now: NOW });

    const [filter] = Listing.find.mock.calls[0];
    expect(filter.status).toBe('active');
    expect(filter.saleFormat).toBe('auction');
    // A scheduled listing is already `active` and visible while its opening is
    // still ahead — featuring it would send readers to a page they cannot bid on.
    expect(filter.startDate).toEqual({ $lte: NOW });
    expect(filter.endDate).toEqual({ $gt: NOW });
    expect(filter['images.0']).toEqual({ $exists: true });
  });

  it('takes the strongest listing of each category before doubling up', async () => {
    mockCandidates([
      listing({ category: 'jewelry', bidCount: 9, slug: 'jewel-top' }),
      listing({ category: 'jewelry', bidCount: 8, slug: 'jewel-second' }),
      listing({ category: 'jewelry', bidCount: 7, slug: 'jewel-third' }),
      listing({ category: 'art', bidCount: 2, slug: 'art-top' }),
      listing({ category: 'vehicles', bidCount: 1, slug: 'car-top' })
    ]);

    const picked = await pickFeaturedAuctions({ limit: 4, now: NOW });

    expect(picked.map(l => l.slug)).toEqual(['jewel-top', 'art-top', 'car-top', 'jewel-second']);
  });

  it('returns what it has when the site cannot fill six slots', async () => {
    mockCandidates([listing({ slug: 'only-one' })]);
    const picked = await pickFeaturedAuctions({ now: NOW });
    expect(picked.map(l => l.slug)).toEqual(['only-one']);
  });

  it('returns nothing when no auction qualifies', async () => {
    mockCandidates([]);
    expect(await pickFeaturedAuctions({ now: NOW })).toEqual([]);
  });
});

describe('localizedTitle / categoryLabel', () => {
  it('falls back through pt and en when a seller did not translate', () => {
    const doc = listing({ titlePt: 'Relógio', titleEn: 'Watch', titleFr: null });
    expect(localizedTitle(doc, 'en')).toBe('Watch');
    expect(localizedTitle(doc, 'fr')).toBe('Relógio');
    expect(localizedTitle(doc, 'zz')).toBe('Relógio');
  });

  it('labels every category in every newsletter language', () => {
    const categories = ['electronics', 'home-garden', 'art', 'collectibles', 'jewelry', 'real-estate', 'vehicles'];
    for (const language of ['pt', 'en', 'es', 'fr']) {
      for (const category of categories) {
        expect(categoryLabel(category, language)).toBeTruthy();
      }
    }
  });
});

describe('renderAuctionsBlock', () => {
  const render = (docs, language = 'pt') =>
    renderAuctionsBlock(docs, language, { baseUrl: 'https://www.bidroom.pt', now: NOW });

  it('renders one card per auction, linking to the listing page', () => {
    const html = render([listing({ slug: 'a' }), listing({ slug: 'b' })]);
    expect(html).toContain('https://www.bidroom.pt/listing/a');
    expect(html).toContain('https://www.bidroom.pt/listing/b');
    expect((html.match(/<table /g) || []).length).toBe(2);
  });

  it('never shows the "No Image" placeholder', () => {
    const html = render([listing({ images: [PLACEHOLDER_IMG] })]);
    expect(html).not.toContain('placeholder.com');
    expect(html).not.toContain('<img');
  });

  it('escapes a title that contains markup', () => {
    const html = render([listing({ titlePt: 'Anel <b>ouro</b> & "raro"' })]);
    expect(html).toContain('Anel &lt;b&gt;ouro&lt;/b&gt; &amp; &quot;raro&quot;');
    expect(html).not.toContain('<b>ouro</b>');
  });

  it('names the price after the auction format and language', () => {
    const bestOffer = listing({ auctionFormat: 'best-offer' });
    expect(render([bestOffer], 'pt')).toContain('Melhor Oferta');
    expect(render([bestOffer], 'fr')).toContain('Meilleure Offre');

    expect(render([listing({ bidCount: 4 })], 'en')).toContain('Current bid');
    expect(render([listing({ bidCount: 0 })], 'en')).toContain('Starting bid');
  });

  it('is empty for an empty list, so no stray block is left behind', () => {
    expect(render([])).toBe('');
  });

  it('uses the BidRoom gold palette, not the retired navy', () => {
    const html = render([listing()]);
    expect(html).toContain('#e8d9a8'); // card border
    expect(html).toContain('#a8872e'); // category + price
    expect(html).not.toContain('#002366');
  });

  it('has no button of its own — the shell owns the CTA', () => {
    const html = render([listing(), listing()]);
    expect(html).not.toMatch(/Ver anúncio|View listing/);
    // Two links per card: the thumbnail and the title.
    expect((html.match(/<a href=/g) || []).length).toBe(4);
  });
});

describe('pickActiveGiveaway', () => {
  it('only asks for a giveaway that is open and not yet drawn', async () => {
    mockCandidates([], []);
    await pickActiveGiveaway({ now: NOW });

    const [filter] = Listing.find.mock.calls[0];
    expect(filter.status).toBe('active');
    expect(filter.saleFormat).toBe('giveaway');
    expect(filter.startDate).toEqual({ $lte: NOW });
    expect(filter.endDate).toEqual({ $gt: NOW });
    // A drawn giveaway is a results page, not an invitation to enter.
    expect(filter['giveaway.drawnAt']).toBeNull();
  });

  it('returns null when none is running', async () => {
    mockCandidates([], []);
    expect(await pickActiveGiveaway({ now: NOW })).toBeNull();
  });

  it('features the one closing soonest', async () => {
    mockCandidates([], [giveawayDoc({ slug: 'closes-first' })]);
    const picked = await pickActiveGiveaway({ now: NOW });

    expect(picked.slug).toBe('closes-first');
    const chain = Listing.find.mock.results[0].value;
    expect(typeof chain.sort).toBe('function');
  });
});

describe('renderGiveawayBlock', () => {
  const render = (doc, language = 'pt') =>
    renderGiveawayBlock(doc, language, { baseUrl: 'https://www.bidroom.pt', now: NOW });

  it('renders nothing at all when no giveaway is running', () => {
    expect(render(null)).toBe('');
    expect(render(undefined)).toBe('');
  });

  it('links to the giveaway and invites the reader to enter for free', () => {
    const html = render(giveawayDoc({ slug: 'relogio-gratis' }));
    expect(html).toContain('https://www.bidroom.pt/listing/relogio-gratis');
    expect(html).toContain('Participar grátis');
  });

  it('is dark, so it does not read as one more auction card', () => {
    const html = render(giveawayDoc());
    expect(html).toContain('#111111');
    expect(html).toContain('#C9A84C');
  });

  it('speaks the reader’s language', () => {
    const doc = giveawayDoc({ titleEn: 'Free watch' });
    expect(render(doc, 'en')).toContain('Enter for free');
    expect(render(doc, 'es')).toContain('Participar gratis');
    expect(render(doc, 'fr')).toContain('Participer gratuitement');
  });

  it('shows entries once there are some, and "free to enter" before that', () => {
    expect(render(giveawayDoc({ giveaway: { entryCount: 0 } }))).toContain('Participação gratuita');

    const busy = render(giveawayDoc({ giveaway: { entryCount: 12 } }));
    expect(busy).toContain('12 participações');
    expect(busy).not.toContain('0 participações');
  });

  it('escapes a title that contains markup', () => {
    const html = render(giveawayDoc({ titlePt: 'Anel <b>ouro</b>' }));
    expect(html).toContain('Anel &lt;b&gt;ouro&lt;/b&gt;');
  });
});

describe('formatPrice', () => {
  it('writes the price the way the design shows it', () => {
    expect(formatPrice(1350, 'pt')).toBe('€ 1.350');
    expect(formatPrice(1350, 'es')).toBe('€ 1.350');
    expect(formatPrice(1350, 'fr')).toBe('€ 1 350');
    expect(formatPrice(1350, 'en')).toBe('€ 1,350');
  });

  it('keeps cents only when there are any', () => {
    expect(formatPrice(240, 'pt')).toBe('€ 240');
    expect(formatPrice(9500.5, 'pt')).toBe('€ 9.500,50');
    expect(formatPrice(9500.5, 'en')).toBe('€ 9,500.50');
  });

  it('survives a missing or unusable amount', () => {
    expect(formatPrice(0, 'pt')).toBe('€ 0');
    expect(formatPrice(null, 'pt')).toBe('€ 0');
    expect(formatPrice(undefined, 'zz')).toBe('€ 0');
  });
});

describe('placeholder expansion', () => {
  it('recognises both spellings, and nothing else', () => {
    expect(hasAuctionPlaceholder('<p>{{AUCTIONS}}</p>')).toBe(true);
    expect(hasAuctionPlaceholder('<p>{{ LEILOES }}</p>')).toBe(true);
    expect(hasAuctionPlaceholder('<p>{{LEILÕES}}</p>')).toBe(true);
    expect(hasAuctionPlaceholder('<p>{{NAME}}</p>')).toBe(false);
    expect(hasAuctionPlaceholder('')).toBe(false);
  });

  it('replaces every occurrence and leaves the rest of the email alone', () => {
    const html = '<h1>Olá</h1>{{AUCTIONS}}<p>meio</p>{{AUCTIONS}}<footer>fim</footer>';
    const out = expandAuctionPlaceholders(html, 'pt', [listing({ slug: 'x' })], {
      baseUrl: 'https://www.bidroom.pt',
      now: NOW
    });
    expect(out).not.toContain('{{AUCTIONS}}');
    expect(out).toContain('<h1>Olá</h1>');
    expect(out).toContain('<footer>fim</footer>');
    expect((out.match(/\/listing\/x/g) || []).length).toBe(4); // 2 blocks × (image + title)
  });

  it('leaves content without a placeholder untouched', () => {
    const html = '<p>sem leilões</p>';
    expect(expandAuctionPlaceholders(html, 'pt', [listing()])).toBe(html);
  });

  it('recognises the giveaway placeholder under its Portuguese names', () => {
    expect(hasGiveawayPlaceholder('{{GIVEAWAY}}')).toBe(true);
    expect(hasGiveawayPlaceholder('{{ PASSATEMPO }}')).toBe(true);
    expect(hasGiveawayPlaceholder('{{SORTEIO}}')).toBe(true);
    expect(hasGiveawayPlaceholder('{{AUCTIONS}}')).toBe(false);
  });

  it('closes the gap when there is no giveaway to announce', () => {
    const html = '<h1>Olá</h1>{{GIVEAWAY}}<p>leilões</p>';
    const out = expandGiveawayPlaceholders(html, 'pt', null);

    expect(out).toBe('<h1>Olá</h1><p>leilões</p>');
  });
});

describe('expandCampaignContent', () => {
  const content = () => ({
    pt: { subject: 'Novidades', html: '<h1>PT</h1>{{AUCTIONS}}' },
    en: { subject: 'News', html: '<h1>EN</h1>{{AUCTIONS}}' },
    es: { subject: 'Novedades', html: '<h1>ES</h1>{{AUCTIONS}}' },
    fr: { subject: 'Nouveautés', html: '<h1>FR</h1>{{AUCTIONS}}' }
  });

  it('picks the auctions once and shows the same ones in every language', async () => {
    mockCandidates([listing({ category: 'jewelry', slug: 'anel' }), listing({ category: 'art', slug: 'tela' })]);

    const { content: out, listings } = await expandCampaignContent(content(), { now: NOW });

    expect(Listing.find).toHaveBeenCalledTimes(1);
    expect(listings.map(l => l.slug)).toEqual(['anel', 'tela']);
    for (const language of ['pt', 'en', 'es', 'fr']) {
      expect(out[language].html).not.toContain('{{AUCTIONS}}');
      expect(out[language].html).toContain('/listing/anel');
      expect(out[language].html).toContain('/listing/tela');
    }
    // Subjects are the admin's own copy and must survive untouched.
    expect(out.fr.subject).toBe('Nouveautés');
  });

  it('translates the card for each language', async () => {
    mockCandidates([listing({ category: 'jewelry', auctionFormat: 'best-offer' })]);
    const { content: out } = await expandCampaignContent(content(), { now: NOW });

    expect(out.pt.html).toContain('Joalharia');
    expect(out.en.html).toContain('Jewelry');
    expect(out.es.html).toContain('Joyería');
    expect(out.fr.html).toContain('Bijouterie');
  });

  it('does not query when no language uses a placeholder', async () => {
    const plain = {
      pt: { subject: 'a', html: '<p>a</p>' },
      en: { subject: 'b', html: '<p>b</p>' }
    };
    const { content: out, listings, giveaway } = await expandCampaignContent(plain, { now: NOW });

    expect(Listing.find).not.toHaveBeenCalled();
    expect(out).toBe(plain);
    expect(listings).toEqual([]);
    expect(giveaway).toBeNull();
  });

  it('does not look for a giveaway when the template does not ask for one', async () => {
    mockCandidates([listing()], [giveawayDoc()]);
    const { giveaway } = await expandCampaignContent(content(), { now: NOW });

    expect(giveaway).toBeNull();
    expect(Listing.find.mock.calls.every(([f]) => f.saleFormat !== 'giveaway')).toBe(true);
  });

  it('sends the email without the block rather than failing when nothing qualifies', async () => {
    mockCandidates([]);
    const { content: out, listings } = await expandCampaignContent(content(), { now: NOW });

    expect(listings).toEqual([]);
    expect(out.pt.html).toBe('<h1>PT</h1>');
  });
});

describe('the weekly template: giveaway and auctions together', () => {
  const weekly = () => ({
    pt: { subject: 'Leilões da semana', html: '<h1>PT</h1>{{GIVEAWAY}}{{AUCTIONS}}' },
    en: { subject: 'This week', html: '<h1>EN</h1>{{GIVEAWAY}}{{AUCTIONS}}' }
  });

  it('fills both blocks, in every language, from one pick each', async () => {
    mockCandidates(
      [listing({ category: 'jewelry', slug: 'anel' })],
      [giveawayDoc({ slug: 'passatempo', titleEn: 'Free watch' })]
    );

    const { content: out, listings, giveaway } = await expandCampaignContent(weekly(), { now: NOW });

    expect(listings.map(l => l.slug)).toEqual(['anel']);
    expect(giveaway.slug).toBe('passatempo');
    expect(out.pt.html).toContain('/listing/passatempo');
    expect(out.pt.html).toContain('/listing/anel');
    expect(out.pt.html).toContain('Participar grátis');
    expect(out.en.html).toContain('Enter for free');
    // One query for the auctions, one for the giveaway — not one per language.
    expect(Listing.find).toHaveBeenCalledTimes(2);
  });

  it('is the same email minus the band on a week with no giveaway', async () => {
    mockCandidates([listing({ slug: 'anel' })], []);

    const { content: out, giveaway } = await expandCampaignContent(weekly(), { now: NOW });

    expect(giveaway).toBeNull();
    expect(out.pt.html).not.toContain('{{GIVEAWAY}}');
    expect(out.pt.html).toContain('/listing/anel');
  });
});
