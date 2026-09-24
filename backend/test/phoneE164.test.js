/**
 * A live connected account sat at "Pending verification" indefinitely because
 * `individual.phone` was past_due and never sent. The numbers we already hold
 * were typed for MBWay or for trader contact details, in whatever shape the
 * seller felt like, so they have to be normalised before Stripe will take them.
 */
const { normalizePhoneE164 } = require('../src/utils/phoneE164');

describe('normalizePhoneE164', () => {
  it('resolves the national forms a Portuguese seller actually types', () => {
    expect(normalizePhoneE164('912345678', 'PT')).toBe('+351912345678');
    expect(normalizePhoneE164('912 345 678', 'PT')).toBe('+351912345678');
    expect(normalizePhoneE164('912-345-678', 'PT')).toBe('+351912345678');
  });

  it('keeps an international number over the address country', () => {
    // Living in PT is no reason to rewrite a Spanish number as Portuguese.
    expect(normalizePhoneE164('+34600123456', 'PT')).toBe('+34600123456');
    expect(normalizePhoneE164('+351 912 345 678', 'PT')).toBe('+351912345678');
  });

  it('reads 00 as the international prefix it is', () => {
    expect(normalizePhoneE164('0034600123456', 'PT')).toBe('+34600123456');
    expect(normalizePhoneE164('00 351 912345678', 'ES')).toBe('+351912345678');
  });

  it('drops the trunk prefix rather than sending it to Stripe', () => {
    expect(normalizePhoneE164('07911123456', 'GB')).toBe('+447911123456');
    expect(normalizePhoneE164('06 12 34 56 78', 'FR')).toBe('+33612345678');
  });

  it('leaves a US number alone, where there is no trunk zero to drop', () => {
    expect(normalizePhoneE164('4155550123', 'US')).toBe('+14155550123');
    expect(normalizePhoneE164('(415) 555-0123', 'US')).toBe('+14155550123');
  });

  it('refuses to invent a number instead of asking the seller', () => {
    expect(normalizePhoneE164('', 'PT')).toBeNull();
    expect(normalizePhoneE164(null, 'PT')).toBeNull();
    expect(normalizePhoneE164(undefined, 'PT')).toBeNull();
    expect(normalizePhoneE164('   ', 'PT')).toBeNull();
    // A country with no dial code in the table: better to ask than to guess.
    expect(normalizePhoneE164('912345678', 'XX')).toBeNull();
    expect(normalizePhoneE164('912345678', null)).toBeNull();
    // Words, not numbers — these really are in free-text contact fields.
    expect(normalizePhoneE164('n/a', 'PT')).toBeNull();
    expect(normalizePhoneE164('sem telefone', 'PT')).toBeNull();
    expect(normalizePhoneE164('912345678 (casa)', 'PT')).toBeNull();
  });

  it('rejects lengths that cannot be a phone number', () => {
    expect(normalizePhoneE164('12345', 'PT')).toBeNull();
    expect(normalizePhoneE164('+1234567890123456789', 'PT')).toBeNull();
    expect(normalizePhoneE164('0', 'PT')).toBeNull();
    expect(normalizePhoneE164('000', 'PT')).toBeNull();
  });

  it('is case-insensitive about the country, as callers are careless with it', () => {
    expect(normalizePhoneE164('912345678', 'pt')).toBe('+351912345678');
  });
});
