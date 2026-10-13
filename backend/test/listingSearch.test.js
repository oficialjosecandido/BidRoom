const {
  tokenizeSearchQuery,
  toAccentInsensitivePattern,
  buildListingSearchClause,
  stripDiacritics
} = require('../src/utils/listingSearch');

describe('listingSearch', () => {
  describe('tokenizeSearchQuery', () => {
    it('drops stopwords and keeps meaningful tokens', () => {
      expect(tokenizeSearchQuery('relógio de homem')).toEqual(['relógio', 'homem']);
      expect(tokenizeSearchQuery('relogio homem')).toEqual(['relogio', 'homem']);
    });

    it('dedupes folded forms', () => {
      expect(tokenizeSearchQuery('Relogio relógio')).toEqual(['relogio']);
    });

    it('returns empty for stopwords-only queries', () => {
      expect(tokenizeSearchQuery('de da do the of')).toEqual([]);
    });
  });

  describe('toAccentInsensitivePattern', () => {
    it('matches accented and plain vowels', () => {
      const re = new RegExp(toAccentInsensitivePattern('relogio'), 'i');
      expect(re.test('Relógio')).toBe(true);
      expect(re.test('Relogio')).toBe(true);
      expect(re.test('RELOGIO')).toBe(true);
      expect(re.test('pulseira')).toBe(false);
    });
  });

  describe('buildListingSearchClause', () => {
    it('requires every token against title/description fields', () => {
      const clause = buildListingSearchClause('relógio de homem');
      expect(clause).toEqual({
        $and: [
          expect.objectContaining({ $or: expect.any(Array) }),
          expect.objectContaining({ $or: expect.any(Array) })
        ]
      });
      expect(clause.$and).toHaveLength(2);
      expect(clause.$and[0].$or.some(c => c.title)).toBe(true);
      expect(clause.$and[0].$or.some(c => c.titlePt)).toBe(true);
    });

    it('returns a single $or when only one token remains', () => {
      const clause = buildListingSearchClause('rolex');
      expect(clause.$or).toBeDefined();
      expect(clause.$and).toBeUndefined();
    });

    it('returns null for empty / stopword-only input', () => {
      expect(buildListingSearchClause('')).toBeNull();
      expect(buildListingSearchClause('   ')).toBeNull();
      expect(buildListingSearchClause('de da')).toBeNull();
    });
  });

  describe('stripDiacritics', () => {
    it('folds Portuguese accents', () => {
      expect(stripDiacritics('Relógio')).toBe('Relogio');
    });
  });
});
