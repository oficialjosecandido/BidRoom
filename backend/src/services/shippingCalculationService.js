const logger = require('../utils/logger');
/**
 * Shipping Calculation Service
 *
 * Integrates with EasyPost to calculate carrier rates for 'calculated' shipping listings.
 * Requires EASYPOST_API_KEY in environment variables.
 *
 * EasyPost free test tier: https://www.easypost.com/docs/api
 * Sign up at https://www.easypost.com to obtain a test API key.
 */

const LOG_PREFIX = '[Shipping]';
const EASYPOST_BASE = 'https://api.easypost.com/v2';
const REQUEST_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Package size presets.
 * Dimensions in inches; weight in ounces (EasyPost uses oz).
 */
const PACKAGE_PRESETS = {
  small:  { length: 8,  width: 6,  height: 4,  weight: 16  }, // ~1 lb
  medium: { length: 12, width: 10, height: 8,  weight: 80  }, // ~5 lbs
  large:  { length: 20, width: 16, height: 12, weight: 320 }  // ~20 lbs
};

/**
 * Make an authenticated POST request to EasyPost.
 * Uses native fetch (available in Node 18+).
 */
async function easypostPost(path, body) {
  const apiKey = process.env.EASYPOST_API_KEY;
  if (!apiKey) {
    throw new Error('EASYPOST_API_KEY is not configured. Please add it to your .env file.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${EASYPOST_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      const e = new Error('Carrier API timed out');
      e.code = 'TIMEOUT';
      throw e;
    }
    throw err;
  }
  clearTimeout(timer);

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `EasyPost error ${response.status}`;
    const e = new Error(message);
    e.code = 'EASYPOST_ERROR';
    e.status = response.status;
    throw e;
  }
  return data;
}

/**
 * Calculate available shipping rates for a shipment.
 *
 * @param {object} origin      - { postalCode, city, country }
 * @param {object} destination - { street1, city, state, postalCode, country }
 * @param {string} packageSize - 'small' | 'medium' | 'large'
 * @returns {Array} rates sorted cheapest first — [{ id, carrier, service, rate, currency, deliveryDays, deliveryDate }]
 */
async function calculateRates({ origin, destination, packageSize }) {
  const parcel = PACKAGE_PRESETS[packageSize] || PACKAGE_PRESETS.small;

  const payload = {
    shipment: {
      from_address: {
        zip: origin.postalCode,
        city: origin.city || '',
        country: origin.country || 'US'
      },
      to_address: {
        street1: destination.street1,
        city: destination.city,
        // Only include state when it has a value — sending empty string causes
        // EasyPost validation errors for countries that don't use state/province.
        ...(destination.state ? { state: destination.state } : {}),
        zip: destination.postalCode,
        country: destination.country || 'PT'
      },
      parcel
    }
  };

  let shipment;
  try {
    shipment = await easypostPost('/shipments', payload);
  } catch (err) {
    logger.error(`${LOG_PREFIX} EasyPost createShipment failed:`, err.message);
    throw err;
  }

  const rates = (shipment.rates || []).map(r => ({
    id: r.id,
    carrier: r.carrier,
    service: r.service,
    rate: parseFloat(r.rate),
    currency: r.currency || 'USD',
    deliveryDays: r.delivery_days ?? null,
    deliveryDate: r.delivery_date ?? null
  }));

  // Sort cheapest first; if same price sort by delivery days ascending
  rates.sort((a, b) => {
    if (a.rate !== b.rate) return a.rate - b.rate;
    return (a.deliveryDays ?? 999) - (b.deliveryDays ?? 999);
  });

  logger.info(`${LOG_PREFIX} Got ${rates.length} rates for ${packageSize} package ${origin.postalCode} → ${destination.postalCode}`);
  return rates;
}

/**
 * Returns the cheapest rate from an array of rates.
 * @param {Array} rates
 * @returns {object|null}
 */
function getCheapestRate(rates) {
  if (!rates || rates.length === 0) return null;
  return rates.reduce((best, r) => (r.rate < best.rate ? r : best));
}

module.exports = { calculateRates, getCheapestRate, PACKAGE_PRESETS };
