jest.mock('../src/models/Listing', () => ({
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(() => Promise.resolve())
}));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

const ENV_KEYS = [
  'SOCIAL_AUTOPOST', 'FB_PAGE_ID', 'PAGE_ACCESS_TOKEN', 'IG_USER_ID',
  'MONGO_URI', 'SOCIAL_PUBLIC_URL', 'META_GRAPH_VERSION', 'SOCIAL_ALLOW_DEV_DATA'
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

    if (href.endsWith('v21.0/')) return reply({ id: body.id }); // link preview refresh
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
    process.env.PAGE_ACCESS_TOKEN = 'TOKEN';
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

    it('adds a brand hashtag when attributes.brand is set', () => {
      const { service } = load();
      const msg = service.buildMessage(listing({
        category: 'watches',
        attributes: { brand: 'Omega' }
      }));
      expect(msg).toContain('#Omega');
      expect(msg).toContain('#relogios');
      expect(msg).toContain('#BidRoom');
    });

    it('adds brand from specifications and strips spaces', () => {
      const { service } = load();
      const msg = service.buildMessage(listing({
        attributes: {},
        specifications: [{ key: 'Marca', value: 'Louis Vuitton' }]
      }));
      expect(msg).toContain('#LouisVuitton');
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

  /** The $set of every outcome recorded, keyed by platform. */
  function recorded(Listing, platform) {
    return Listing.updateOne.mock.calls
      .map(([, update]) => update.$set)
      .filter(set => Object.keys(set)[0].startsWith(`socialPosts.${platform}.`));
  }

  describe('publishApprovedListing', () => {
    it('does nothing when auto-post is disabled', async () => {
      const calls = mockGraph();
      const { service, Listing } = load();
      await service.publishApprovedListing('L1');
      expect(Listing.findOneAndUpdate).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
    });

    it('only claims a platform never attempted, and posts nothing when both were', async () => {
      configureProduction();
      const calls = mockGraph();
      const { service, Listing } = load();
      Listing.findOneAndUpdate.mockReturnValue({ lean: async () => null });

      await service.publishApprovedListing('L1');

      const filters = Listing.findOneAndUpdate.mock.calls.map(([filter]) => filter);
      expect(filters).toHaveLength(2);
      expect(filters).toContainEqual(expect.objectContaining({
        _id: 'L1', status: 'active', 'socialPosts.facebook.status': null
      }));
      expect(filters).toContainEqual(expect.objectContaining({ 'socialPosts.instagram.status': null }));
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

      expect(recorded(Listing, 'facebook')).toContainEqual(expect.objectContaining({
        'socialPosts.facebook.status': 'published', 'socialPosts.facebook.postId': 'PAGE_POST'
      }));
      expect(recorded(Listing, 'instagram')).toContainEqual(expect.objectContaining({
        'socialPosts.instagram.status': 'published',
        'socialPosts.instagram.mediaId': 'MEDIA1',
        'socialPosts.instagram.permalink': 'https://instagram.com/p/abc',
        'socialPosts.instagram.imageCount': 1
      }));
    });

    it('still posts to Instagram when Facebook fails, and records the error', async () => {
      configureProduction();
      mockGraph({ fail: { facebook: 'Invalid OAuth access token' } });
      const { service, Listing } = load();
      Listing.findOneAndUpdate.mockReturnValue({ lean: async () => listing() });

      await service.publishApprovedListing('L1');

      expect(recorded(Listing, 'facebook')).toContainEqual({
        'socialPosts.facebook.status': 'failed',
        'socialPosts.facebook.error': 'Facebook — Invalid OAuth access token'
      });
      expect(recorded(Listing, 'instagram')).toContainEqual(expect.objectContaining({
        'socialPosts.instagram.status': 'published', 'socialPosts.instagram.mediaId': 'MEDIA1'
      }));
    });

    it('skips Instagram without IG_USER_ID and still posts to Facebook', async () => {
      configureProduction();
      delete process.env.IG_USER_ID;
      const calls = mockGraph();
      const { service, Listing } = load();
      Listing.findOneAndUpdate.mockReturnValue({ lean: async () => listing() });

      await service.publishApprovedListing('L1');

      expect(Listing.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(calls.some(c => c.href.includes('/IG/'))).toBe(false);
      expect(calls.some(c => c.href.endsWith('/PAGE/feed'))).toBe(true);
    });
  });

  describe('requestPublish', () => {
    const flush = () => new Promise(resolve => setImmediate(resolve));

    function withListing(Listing, ...docs) {
      Listing.findById = jest.fn();
      docs.forEach(doc => Listing.findById.mockReturnValueOnce({ select: () => ({ lean: async () => doc }) }));
    }

    it('refuses a development database unless SOCIAL_ALLOW_DEV_DATA is "true"', async () => {
      configureProduction();
      process.env.MONGO_URI = 'mongodb+srv://u:p@cluster.mongodb.net/bidroom-dev';
      const { service } = load();
      await expect(service.requestPublish('L1', 'facebook'))
        .rejects.toMatchObject({ statusCode: 503, code: 'not_configured' });

      process.env.SOCIAL_ALLOW_DEV_DATA = 'true';
      expect(service.platformBlocker('facebook')).toBeNull();
      delete process.env.SOCIAL_ALLOW_DEV_DATA;
    });

    it('refuses a listing that is not live', async () => {
      configureProduction();
      const { service, Listing } = load();
      withListing(Listing, listing({ status: 'pending_review' }));
      await expect(service.requestPublish('L1', 'facebook'))
        .rejects.toMatchObject({ statusCode: 409, code: 'not_publishable' });
      expect(Listing.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('refuses Instagram for a listing with only the placeholder image', async () => {
      configureProduction();
      const { service, Listing } = load();
      withListing(Listing, listing({ images: ['https://via.placeholder.com/400x300?text=No+Image'] }));
      await expect(service.requestPublish('L1', 'instagram'))
        .rejects.toMatchObject({ code: 'no_images' });
    });

    it('answers already_posted for a published platform, and claims it again with repost', async () => {
      configureProduction();
      const calls = mockGraph();
      const { service, Listing } = load();
      const published = listing({ socialPosts: { facebook: { status: 'published', postedAt: new Date(), postId: 'OLD' } } });

      withListing(Listing, published, published);
      Listing.findOneAndUpdate.mockReturnValueOnce({ lean: async () => null });
      await expect(service.requestPublish('L1', 'facebook'))
        .rejects.toMatchObject({ statusCode: 409, code: 'already_posted' });
      expect(Listing.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ 'socialPosts.facebook.postedAt': null });

      withListing(Listing, published);
      Listing.findOneAndUpdate.mockReturnValueOnce({ lean: async () => published });
      await expect(service.requestPublish('L1', 'facebook', { repost: true, requestedBy: 'admin@bidroom.pt' }))
        .resolves.toMatchObject({ status: 'publishing' });
      const [filter, update] = Listing.findOneAndUpdate.mock.calls[1];
      expect(filter).not.toHaveProperty(['socialPosts.facebook.postedAt']);
      expect(update.$set['socialPosts.facebook.requestedBy']).toBe('admin@bidroom.pt');

      await flush();
      await flush();
      expect(calls.filter(c => c.href.endsWith('/PAGE/feed'))).toHaveLength(1);
    });

    it('answers in_progress while the platform is being published', async () => {
      configureProduction();
      const { service, Listing } = load();
      const publishing = listing({ socialPosts: { instagram: { status: 'publishing', startedAt: new Date() } } });
      withListing(Listing, publishing, publishing);
      Listing.findOneAndUpdate.mockReturnValue({ lean: async () => null });
      await expect(service.requestPublish('L1', 'instagram'))
        .rejects.toMatchObject({ code: 'in_progress' });
    });
  });

  describe('getSocialOverview', () => {
    it('shows a publish that never finished as failed', async () => {
      configureProduction();
      const { service, Listing } = load();
      const stuck = new Date(Date.now() - service.STALE_PUBLISH_MS - 1000);
      Listing.findById = jest.fn(() => ({
        select: () => ({ lean: async () => listing({ socialPosts: { facebook: { status: 'publishing', startedAt: stuck } } }) })
      }));

      const overview = await service.getSocialOverview('L1');

      expect(overview.platforms.facebook.state.status).toBe('failed');
      expect(overview.platforms.facebook.available).toBe(true);
      expect(overview.platforms.instagram).toMatchObject({ available: true, state: null });
      expect(overview.caption).toContain('Omega Seamaster');
    });
  });
});
