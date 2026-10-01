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

/**
 * The address as display lines, in the order a label is written.
 * Mirrors formatBuyerDeliveryAddressLines() in the dashboard so the seller reads
 * the same address in the email, the notification and the UI.
 */
function formatDeliveryAddressLines(addr) {
  const street1 = String(addr?.street1 || '').trim();
  if (!street1) return [];
  const lines = [street1];
  const cityLine = [addr.postalCode, addr.city]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  const state = String(addr.state || '').trim();
  if (state) {
    lines.push([cityLine, state].filter(Boolean).join(', '));
  } else if (cityLine) {
    lines.push(cityLine);
  }
  const country = String(addr.country || '').trim();
  if (country) lines.push(country.toUpperCase());
  return lines;
}

/** Same address collapsed onto one line, for notification text. */
function formatDeliveryAddressOneLine(addr) {
  return formatDeliveryAddressLines(addr).join(', ');
}

module.exports = {
  normalizeDeliveryAddress,
  shippingNeedsDeliveryAddress,
  attachBuyerDeliveryAddressIfMissing,
  formatDeliveryAddressLines,
  formatDeliveryAddressOneLine
};
