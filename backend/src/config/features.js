/**
 * Feature flags — controlled via environment variables.
 * Defaults are off (opt-in). Set to the string "true" to enable.
 *
 *   FEATURE_MEMBERSHIP_TIERS=true
 *   FEATURE_CREATE_LISTING_OUTSIDE_PT=true
 *   FEATURE_REQUIRE_NIF=true
 */
const features = {
  /**
   * Membership tiers + Add Funds / balance top-up.
   * Controls: tier display, "Add Funds" button, balance checkout, offererTier on offers.
   */
  membershipTiers: process.env.FEATURE_MEMBERSHIP_TIERS === 'true',

  /**
   * Allow sellers to create listings with a shipping origin outside Portugal.
   * When false (default), the add-listing form restricts shippingOriginCountry to PT.
   */
  createListingOutsidePt: process.env.FEATURE_CREATE_LISTING_OUTSIDE_PT === 'true',

  /**
   * Require users to provide their NIF (Portuguese tax ID) during signup.
   * When false (default), NIF field is optional / hidden.
   */
  requireNif: process.env.FEATURE_REQUIRE_NIF === 'true'
};

module.exports = features;
