/**
 * Compliance gate for vehicle listings.
 *
 * Cars carry two obligations that the rest of the catalogue does not:
 *
 *  1. A professional seller owes the buyer the consumer warranty in DL 84/2021.
 *     Letting a trader list as a private party would have BidRoom facilitating
 *     the avoidance of that warranty, so the classification must be declared
 *     deliberately, be complete, and be visible to the buyer.
 *
 *  2. High-value cars are a known laundering route. BidRoom never touches the
 *     money for the car, which keeps the exposure small, and a value ceiling
 *     plus verified identity keeps it small.
 *
 * The thresholds themselves live in config/vehicleRules.js and are all pending
 * legal review.
 */

const Listing = require('../models/Listing');
const FraudEvent = require('../models/FraudEvent');
const rules = require('../config/vehicleRules');
const logger = require('../utils/logger');

/** The category this whole module is about. */
const VEHICLE_CATEGORY = 'vehicles';

/**
 * A refusal the route turns into an HTTP response.
 *
 * `code` is the contract with the frontend: it decides which screen to send the
 * seller to (declare a classification, finish the trader details, verify
 * identity), so it is stable and machine-readable, while `message` is only for
 * humans and may be reworded freely.
 */
class VehicleComplianceError extends Error {
  constructor(code, message, statusCode = 403, details = {}) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** The highest price the seller has set — the figure the ceiling applies to. */
function declaredValue(listingData) {
  return rules.VALUE_CAP_APPLIES_TO
    .map(field => Number(listingData[field]) || 0)
    .reduce((max, n) => Math.max(max, n), 0);
}

/**
 * Everything a vehicle listing must satisfy before it can be created.
 *
 * Throws VehicleComplianceError on the first failure; returns silently for any
 * category that is not a vehicle, so callers can invoke it unconditionally.
 */
function assertVehicleListingAllowed({ category, seller, ...listingData }) {
  if (category !== VEHICLE_CATEGORY) return;

  // 1. The classification has to be a deliberate answer. `private` is the
  //    schema default, so the timestamp is the only proof the seller was asked.
  //    `professionalSubmittedAt` counts as the same proof: filling in the trader
  //    form is not something that happens by default. Accepting it means sellers
  //    who declared before the timestamp field existed are not sent back to
  //    re-answer a question they already answered.
  if (!seller.sellerClassificationDeclaredAt && !seller.professionalSubmittedAt) {
    throw new VehicleComplianceError(
      'vehicle_declaration_required',
      'Para vender um veículo, indique se é vendedor particular ou profissional.',
      403,
      { currentClassification: seller.sellerClassification || 'private' }
    );
  }

  // 2. A trader's details are what the buyer relies on to exercise the warranty,
  //    so an incomplete trader profile cannot list a car. Listing creation
  //    already requires an admin-verified trader profile for every category;
  //    this is the field-level backstop, so the service is safe to call from
  //    anywhere the route-level gate is not in play.
  if (seller.sellerClassification === 'professional') {
    const missing = ['professionalLegalName', 'professionalVatId'].filter(f => !seller[f]);
    if (missing.length) {
      throw new VehicleComplianceError(
        'vehicle_professional_details_required',
        'Vendedores profissionais devem fornecer nome legal e NIF/NIPC antes de anunciar um veículo.',
        403,
        { missing }
      );
    }
  }

  // 3. Identity. An anonymous seller of a high-value car is the worst AML case,
  //    and the platform already runs KYC for high-value listings — vehicles
  //    require it at any price.
  if (seller.kycStatus !== 'approved') {
    throw new VehicleComplianceError(
      'vehicle_kyc_required',
      'Para vender veículos, é necessário verificar a sua identidade primeiro.',
      403,
      { kycStatus: seller.kycStatus || 'none', requiresKyc: true }
    );
  }

  // 4. The AML terms. BidRoom never handles the money for the car, so requiring
  //    in writing that the payment be traceable is the one control it has over
  //    how the car is paid for.
  if (listingData.vehicleAmlDeclaration !== true) {
    throw new VehicleComplianceError(
      'vehicle_aml_terms_required',
      'É necessário aceitar os termos de pagamento rastreável para anunciar um veículo.',
      400
    );
  }

  // 5. The value ceiling. Applies to what the seller sets, never to what the
  //    bidding reaches — see VALUE_CAP_APPLIES_TO for why.
  const value = declaredValue(listingData);
  if (value > rules.MAX_VEHICLE_VALUE_EUR) {
    const cap = rules.MAX_VEHICLE_VALUE_EUR.toLocaleString('pt-PT');
    throw new VehicleComplianceError(
      'vehicle_value_cap_exceeded',
      `Veículos com valor acima de €${cap} não podem ser anunciados de momento.`,
      400,
      { maxValue: rules.MAX_VEHICLE_VALUE_EUR, declaredValue: value }
    );
  }
}

/** Vehicle listings this seller has created since the same date last year. */
async function countVehicleListingsThisYear(sellerId) {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  return Listing.countDocuments({
    seller: sellerId,
    category: VEHICLE_CATEGORY,
    createdAt: { $gte: oneYearAgo }
  });
}

/**
 * Flag a self-declared private seller who is behaving like a trader.
 *
 * Deliberately never blocks. Where "professional in fact" begins is a legal
 * question with no number in the statute, so the safe move is to put the
 * account in front of a human — which is also what shows BidRoom exercised
 * diligence. Never throws: a compliance flag must not fail a listing.
 */
async function flagUndeclaredProfessional(seller) {
  try {
    if (seller.sellerClassification !== 'private') return null;

    const count = await countVehicleListingsThisYear(seller._id);
    if (count < rules.PRIVATE_SELLER_VEHICLE_THRESHOLD) return null;

    // One open flag per seller is enough; re-flagging on every listing would
    // bury the queue in duplicates of the same account.
    const open = await FraudEvent.findOne({
      type: 'undeclared_professional',
      userId: seller._id,
      resolved: false
    }).select('_id').lean();
    if (open) return null;

    return await FraudEvent.create({
      type: 'undeclared_professional',
      severity: 'medium',
      userId: seller._id,
      details: {
        vehicleListingsLast12Months: count,
        threshold: rules.PRIVATE_SELLER_VEHICLE_THRESHOLD,
        note: 'Declared private but listing vehicles at a trader-like rate. Consumer warranty (DL 84/2021) may be owed.'
      }
    });
  } catch (err) {
    logger.error('[vehicleCompliance] undeclared-professional flag failed:', err.message);
    return null;
  }
}

module.exports = {
  VEHICLE_CATEGORY,
  VehicleComplianceError,
  assertVehicleListingAllowed,
  countVehicleListingsThisYear,
  flagUndeclaredProfessional
};
