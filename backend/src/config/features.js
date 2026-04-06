/**
 * Feature flags — controlled via environment variables.
 * Defaults are off (opt-in). Set to the string "true" to enable.
 *
 *   FEATURE_MEMBERSHIP_TIERS=true
 */
const features = {
  /**
   * Membership tiers + Add Funds / balance top-up.
   * Controls: tier display, "Add Funds" button, balance checkout, offererTier on offers.
   */
  membershipTiers: process.env.FEATURE_MEMBERSHIP_TIERS === 'true'
};

module.exports = features;
