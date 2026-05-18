/**
 * Packaging requirements per listing category.
 * Shown to buyers in the damage claim form and to admins during compliance review.
 * If the seller fails these requirements, the carrier claim may be rejected and
 * the seller bears the loss (packagingCompliant = false on the DamageClaim).
 */
const PACKAGING_POLICY = {
  electronics: {
    label: 'Electronics',
    requirements: [
      'Wrap in anti-static bubble wrap (min 2 layers)',
      'Use a rigid double-wall cardboard box',
      'Fill all empty space with foam peanuts or air pillows',
      'Mark box as FRAGILE on all sides'
    ]
  },
  'home-garden': {
    label: 'Home & Garden',
    requirements: [
      'Wrap fragile items in at least 2 layers of bubble wrap',
      'Use a box with at least 5 cm padding on all sides',
      'Fill gaps with packing paper or foam',
      'Mark box as FRAGILE for breakable items'
    ]
  },
  art: {
    label: 'Art',
    requirements: [
      'Wrap with acid-free tissue paper first, then bubble wrap (min 3 layers)',
      'Use a rigid box or crate — no envelopes',
      'Insert cardboard corner protectors for framed pieces',
      'Mark box as DO NOT BEND / FRAGILE',
      'Include a "THIS SIDE UP" label where applicable'
    ]
  },
  collectibles: {
    label: 'Collectibles',
    requirements: [
      'Wrap individual items in bubble wrap (min 2 layers)',
      'Double-box: inner box padded, outer box with 5 cm gap',
      'Use rigid cardboard — no soft mailers for breakable collectibles',
      'Mark FRAGILE on outer box'
    ]
  },
  jewelry: {
    label: 'Jewelry & Watches',
    requirements: [
      'Place item in a rigid gift box or padded jewellery box',
      'Wrap box in bubble wrap and seal in a padded mailer or small box',
      'Add silica gel packet if shipping watches',
      'Do not mention jewellery or watches on the outer label (theft prevention)'
    ]
  }
};

const DEFAULT_REQUIREMENTS = [
  'Use appropriate packaging for the item type and fragility',
  'Include sufficient padding on all sides (min 5 cm)',
  'Seal the box securely with packing tape on all seams',
  'Mark as FRAGILE if applicable'
];

/**
 * Returns packaging requirements for a given category slug.
 * Falls back to generic requirements if category is unknown.
 */
function getPackagingRequirements(category) {
  return PACKAGING_POLICY[category] ?? { label: 'General', requirements: DEFAULT_REQUIREMENTS };
}

module.exports = { PACKAGING_POLICY, getPackagingRequirements };
