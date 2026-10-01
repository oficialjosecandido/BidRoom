/**
 * Buyer delivery address helpers — stored on Transaction.buyerDeliveryAddress
 * and optionally prefilled from Customer.deliveryAddress.
 */

function normalizeDeliveryAddress(addr) {
  if (!addr) return null;
  const street1 = String(addr.street1 || '').trim();
  if (!street1) return null;
  const city = String(addr.city || '').trim();
  const postalCode = String(addr.postalCode || '').trim();
  const country = String(addr.country || 'PT').trim().toUpperCase().slice(0, 2);
  if (!city || !postalCode || !/^[A-Z]{2}$/.test(country)) return null;
  const state = String(addr.state || '').trim();
  return {
    street1: street1.slice(0, 300),
    city: city.slice(0, 120),
    state: state ? state.slice(0, 120) : null,
    postalCode: postalCode.slice(0, 32),
    country
  };
}

/** Local pickup does not need a destinaton address for the seller. */
function shippingNeedsDeliveryAddress(shippingOption) {
  return shippingOption !== 'local-pickup';
}

/**
 * If the transaction has no delivery address yet, copy from the buyer's saved
 * profile address. Returns true when the transaction document was mutated.
 */
function attachBuyerDeliveryAddressIfMissing(transaction, buyerDoc, shippingOption) {
  if (transaction.buyerDeliveryAddress?.street1) return false;
  if (!shippingNeedsDeliveryAddress(shippingOption)) return false;
  const fromProfile = normalizeDeliveryAddress(buyerDoc?.deliveryAddress);
  if (!fromProfile) return false;
  transaction.buyerDeliveryAddress = fromProfile;
  return true;
}

module.exports = {
  normalizeDeliveryAddress,
  shippingNeedsDeliveryAddress,
  attachBuyerDeliveryAddressIfMissing
};
