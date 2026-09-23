jest.mock('../src/models/Listing', () => ({ find: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../src/utils/publicUrls', () => ({ publicBaseUrl: () => 'https://www.bidroom.pt' }));

const Listing = require('../src/models/Listing');
const {
  pickFeaturedAuctions,
  renderAuctionsBlock,
  expandAuctionPlaceholders,
  expandCampaignContent,
  hasAuctionPlaceholder,
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

/** Listing.find(...).sort(...).limit(...).lean() */
function mockCandidates(docs) {
  Listing.find.mockReturnValue({
    sort: () => ({ limit: () => ({ lean: async () => docs }) })
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

  it('does not query when no language uses the placeholder', async () => {
    const plain = {
      pt: { subject: 'a', html: '<p>a</p>' },
      en: { subject: 'b', html: '<p>b</p>' }
    };
    const { content: out, listings } = await expandCampaignContent(plain, { now: NOW });

    expect(Listing.find).not.toHaveBeenCalled();
    expect(out).toBe(plain);
    expect(listings).toEqual([]);
  });

  it('sends the email without the block rather than failing when nothing qualifies', async () => {
    mockCandidates([]);
    const { content: out, listings } = await expandCampaignContent(content(), { now: NOW });

    expect(listings).toEqual([]);
    expect(out.pt.html).toBe('<h1>PT</h1>');
  });
});
