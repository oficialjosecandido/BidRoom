const {
  pickShareLocale,
  buildOgTitle,
  buildOgDescription,
  getLocalizedListingText
} = require('../src/utils/shareMeta');

describe('shareMeta', () => {
  it('pickShareLocale prefers pt for pt-PT', () => {
    expect(pickShareLocale('pt-PT,pt;q=0.9,en;q=0.8')).toBe('pt');
  });

  it('pickShareLocale prefers en for en-US', () => {
    expect(pickShareLocale('en-US,en;q=0.9')).toBe('en');
  });

  it('buildOgTitle prefixes BidRoom', () => {
    expect(buildOgTitle('Rolex Datejust')).toBe('BidRoom - Rolex Datejust');
  });

  it('buildOgDescription truncates and appends Bid Now', () => {
    const long = 'word '.repeat(40).trim();
    const out = buildOgDescription(long, 'en');
    expect(out.endsWith('Bid Now')).toBe(true);
    expect(out.length).toBeLessThan(long.length + 10);
  });

  it('buildOgDescription uses Licite já for pt', () => {
    expect(buildOgDescription('Relógio em excelente estado', 'pt')).toBe(
      'Relógio em excelente estado Licite já'
    );
  });

  it('getLocalizedListingText uses localized fields', () => {
    const listing = {
      title: 'Default',
      titleEn: 'English title',
      description: 'Desc',
      descriptionEn: 'English desc'
    };
    expect(getLocalizedListingText(listing, 'en')).toEqual({
      title: 'English title',
      description: 'English desc'
    });
  });
});
