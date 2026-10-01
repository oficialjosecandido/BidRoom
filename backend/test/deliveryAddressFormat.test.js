const {
  formatDeliveryAddressLines,
  formatDeliveryAddressOneLine
} = require('../src/utils/deliveryAddress');

describe('delivery address formatting', () => {
  const ptAddress = {
    street1: 'Rua das Flores 12, 3º Esq',
    city: 'Ericeira',
    state: null,
    postalCode: '2655-320',
    country: 'PT'
  };

  it('writes a Portuguese address the way a label is addressed', () => {
    expect(formatDeliveryAddressLines(ptAddress)).toEqual([
      'Rua das Flores 12, 3º Esq',
      '2655-320 Ericeira',
      'PT'
    ]);
  });

  it('keeps the state on the city line where one exists', () => {
    expect(formatDeliveryAddressLines({
      street1: '123 Main St',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      country: 'us'
    })).toEqual(['123 Main St', '78701 Austin, TX', 'US']);
  });

  // Without a street there is nothing to ship to, so callers can treat an empty
  // list as "no address" and skip the whole block.
  it('returns nothing when there is no street', () => {
    expect(formatDeliveryAddressLines({ city: 'Lisboa', postalCode: '1000-001' })).toEqual([]);
    expect(formatDeliveryAddressLines(null)).toEqual([]);
    expect(formatDeliveryAddressLines(undefined)).toEqual([]);
    expect(formatDeliveryAddressOneLine(null)).toBe('');
  });

  it('collapses to one line for notification text', () => {
    expect(formatDeliveryAddressOneLine(ptAddress))
      .toBe('Rua das Flores 12, 3º Esq, 2655-320 Ericeira, PT');
  });

  it('drops missing parts instead of leaving gaps', () => {
    expect(formatDeliveryAddressLines({ street1: 'Apartado 42', country: 'PT' }))
      .toEqual(['Apartado 42', 'PT']);
  });
});
