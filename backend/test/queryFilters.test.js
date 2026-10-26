const { queryString, publicBrowseStatus } = require('../src/utils/queryFilters');

describe('queryString', () => {
  it('returns a trimmed string', () => {
    expect(queryString('  photography ')).toBe('photography');
  });

  it('returns empty for an array or object, which Express builds from brackets', () => {
    expect(queryString(['a', 'b'])).toBe('');
    expect(queryString({ $ne: 'x' })).toBe('');
  });

  it('returns empty for absent values', () => {
    expect(queryString(undefined)).toBe('');
    expect(queryString(null)).toBe('');
  });
});

describe('publicBrowseStatus', () => {
  it('allows the two statuses the catalogue shows', () => {
    expect(publicBrowseStatus('active')).toBe('active');
    expect(publicBrowseStatus('ended')).toBe('ended');
  });

  it('never serves the moderation queue', () => {
    expect(publicBrowseStatus('pending_review')).toBe('active');
    expect(publicBrowseStatus('draft')).toBe('active');
  });

  it('never serves a listing the seller pulled', () => {
    expect(publicBrowseStatus('cancelled')).toBe('active');
  });

  it('defaults to active for absent, unknown or non-string input', () => {
    expect(publicBrowseStatus(undefined)).toBe('active');
    expect(publicBrowseStatus('nonsense')).toBe('active');
    expect(publicBrowseStatus({ $ne: 'active' })).toBe('active');
    expect(publicBrowseStatus(['draft'])).toBe('active');
  });
});
