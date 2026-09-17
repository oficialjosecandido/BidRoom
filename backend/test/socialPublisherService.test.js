jest.mock('../src/models/Listing', () => ({
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(() => Promise.resolve())
}));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

const ENV_KEYS = [
  'SOCIAL_AUTOPOST', 'FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN', 'IG_USER_ID',
  'MONGO_URI', 'SOCIAL_PUBLIC_URL', 'META_GRAPH_VERSION'
];

function load() {
  return {
    service: require('../src/services/socialPublisherService'),
    Listing: require('../src/models/Listing')
  };
}

const listing = (overrides = {}) => ({
  _id: 'L1',
  slug: 'relogio-omega',
  title: 'Omega Seamaster',
  description: 'Relógio em excelente estado.',
  saleFormat: 'auction',
  currentPrice: 150,
  buyNowPrice: null,
  endDate: new Date('2026-09-20T17:00:00Z'),
  images: ['https://bidroom.blob.core.windows.net/a.jpg'],
  status: 'active',
  ...overrides
});

/** Routes Graph API calls by URL; `fail` makes a matching call return a Graph error. */
function mockGraph({ fail = {} } = {}) {
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    const href = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ href, body });
    const reply = data => ({ json: async () => data });

    if (href.endsWith('/PAGE/feed')) {
      return reply(fail.facebook ? { error: { message: fail.facebook } } : { id: 'PAGE_POST' });
    }
    if (href.endsWith('/IG/media')) return reply({ id: `C${calls.length}` });
    if (href.endsWith('/IG/media_publish')) return reply({ id: 'MEDIA1' });
    if (href.includes('fields=status_code')) return reply({ status_code: 'FINISHED' });
    if (href.includes('/MEDIA1?')) {
      return reply({ media_type: 'IMAGE', permalink: 'https://instagram.com/p/abc' });
    }
    throw new Error(`unexpected call ${href}`);
  });
  return calls;
}

describe('socialPublisherService', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
    ENV_KEYS.forEach(k => delete process.env[k]);
    process.env.SOCIAL_PUBLIC_URL = 'https://www.bidroom.pt';
  });

  afterEach(() => {
    ENV_KEYS.forEach(k => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
    delete global.fetch;
  });

  function configureProduction() {
    process.env.SOCIAL_AUTOPOST = 'true';
    process.env.FB_PAGE_ID = 'PAGE';
    process.env.FB_PAGE_ACCESS_TOKEN = 'TOKEN';
    process.env.IG_USER_ID = 'IG';
    process.env.MONGO_URI = 'mongodb+srv://u:p@cluster.mongodb.net/bidroom';
  }

  describe('buildMessage', () => {
    it('shows price, end time in Lisbon time and the public link', () => {
      const { service } = load();
      const msg = service.buildMessage(listing());
      expect(msg).toContain('🔨 Omega Seamaster');
      expect(msg).toContain('150,00');
      // 17:00 UTC is 18:00 in Lisbon (summer time), whatever the server's zone.
      expect(msg).toContain('18:00');
      expect(msg).toContain('https://www.bidroom.pt/listing/relogio-omega');
    });

    it('describes a giveaway without prices', () => {
      const { service } = load();
      const msg = service.buildMessage(listing({ saleFormat: 'giveaway' }));
      expect(msg).toContain('PASSATEMPO');
      expect(msg).not.toContain('Licitação');
    });
  });

  it('publishableImages drops placeholders and non-https URLs', () => {
    const { service } = load();
    expect(service.publishableImages(listing({
      images: [
        'https://via.placeholder.com/400x300?text=No+Image',
        'http://insecure.example/a.jpg',
        'https://bidroom.blob.core.windows.net/b.jpg'
      ]
    }))).toEqual(['https://bidroom.blob.core.windows.net/b.jpg']);
  });

  describe('autopostBlocker', () => {
    it('is off unless SOCIAL_AUTOPOST is "true"', () => {
      configureProduction();
      delete process.env.SOCIAL_AUTOPOST;
      expect(load().service.autopostBlocker()).toMatch(/SOCIAL_AUTOPOST/);
    });

    it('refuses a development database', () => {
      configureProduction();
      process.env.MONGO_URI = 'mongodb+srv://u:p@cluster.mongodb.net/bidroom-dev';
      expect(load().service.autopostBlocker()).toMatch(/bidroom-dev/);
    });

    it('allows a configured production process', () => {
      configureProduction();
      expect(load().service.autopostBlocker()).toBeNull();
    });
  });

  describe('publishApprovedListing', () => {
    it('does nothing when auto-post is disabled', async () => {
      const calls = mockGraph();
      const { service, Listing } = load();
      await service.publishApprovedListing('L1');
      expect(Listing.findOneAndUpdate).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
    });

    it('does not post a listing someone else already claimed', async () => {
      configureProduction();
      const calls = mockGraph();
      const { service, Listing } = load();
      Listing.findOneAndUpdate.mockReturnValue({ lean: async () => null });

      await service.publishApprovedListing('L1');

      expect(Listing.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
        _id: 'L1', status: 'active', 'socialPosts.claimedAt': null
      });
      expect(calls).toHaveLength(0);
    });

    it('posts to Facebook and Instagram and records both', async () => {
      configureProduction();
      const calls = mockGraph();
      const { service, Listing } = load();
      Listing.findOneAndUpdate.mockReturnValue({ lean: async () => listing() });

      await service.publishApprovedListing('L1');

      const feed = calls.find(c => c.href.endsWith('/PAGE/feed'));
      expect(feed.body.link).toBe('https://www.bidroom.pt/listing/relogio-omega');
      expect(calls.filter(c => c.href.endsWith('/IG/media_publish'))).toHaveLength(1);

      const sets = Listing.updateOne.mock.calls.map(([, update]) => update.$set);
      expect(sets).toContainEqual({
        'socialPosts.facebook': expect.objectContaining({ postId: 'PAGE_POST', error: null })
      });
      expect(sets).toContainEqual({
        'socialPosts.instagram': expect.objectContaining({
          mediaId: 'MEDIA1', permalink: 'https://instagram.com/p/abc', imageCount: 1, error: null
        })
      });
    });

    it('still posts to Instagram when Facebook fails, and records the error', async () => {
      configureProduction();
      mockGraph({ fail: { facebook: 'Invalid OAuth access token' } });
      const { service, Listing } = load();
      Listing.findOneAndUpdate.mockReturnValue({ lean: async () => listing() });

      await service.publishApprovedListing('L1');

      const sets = Listing.updateOne.mock.calls.map(([, update]) => update.$set);
      expect(sets).toContainEqual({
        'socialPosts.facebook': expect.objectContaining({ postId: null, error: 'Facebook — Invalid OAuth access token' })
      });
      expect(sets).toContainEqual({
        'socialPosts.instagram': expect.objectContaining({ mediaId: 'MEDIA1', error: null })
      });
    });
  });
});
