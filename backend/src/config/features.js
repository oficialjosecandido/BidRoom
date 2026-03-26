/**
 * Feature flags — controlled via environment variables.
 * Default is enabled (true) if the variable is unset.
 *
 * To disable a feature, set the variable to the string "false" in .env:
 *   FEATURE_MEMBERSHIP_TIERS=false
 */
const features = {
  /**
   * Membership tiers + Add Funds / balance top-up.
   * Controls: tier display, "Add Funds" button, balance checkout, offererTier on offers.
   */
  membershipTiers: process.env.FEATURE_MEMBERSHIP_TIERS !== 'false'
};

module.exports = features;
