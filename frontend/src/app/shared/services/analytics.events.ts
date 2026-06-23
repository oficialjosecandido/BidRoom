/** Event name catalogue — shared by GA4 (AnalyticsService) and PostHog (PostHogService). */
export const AnalyticsEvents = {
  // ── Auction & bidding ──────────────────────────────────────────────────────
  BID_MODAL_OPEN:  'bid_modal_open',
  BID_PLACED:      'bid_placed',
  OFFER_MODAL_OPEN: 'offer_modal_open',
  OFFER_PLACED:    'offer_placed',
  BUY_NOW_CLICK:   'buy_now_click',
  BUY_NOW_COMPLETE: 'buy_now_complete',

  // ── Listing discovery ──────────────────────────────────────────────────────
  LISTING_VIEWED:   'listing_viewed',
  WATCHLIST_ADD:    'watchlist_add',
  WATCHLIST_REMOVE: 'watchlist_remove',
  SHARE_LISTING:    'share_listing',
  SEARCH_PERFORMED: 'search_performed',
  CATEGORY_BROWSED: 'category_browsed',

  // ── Listing creation ───────────────────────────────────────────────────────
  LISTING_DRAFT_CREATED: 'listing_draft_created',
  LISTING_PUBLISHED:     'listing_published',

  // ── Private room ──────────────────────────────────────────────────────────
  PRIVATE_ROOM_OPEN:            'private_room_open',
  PRIVATE_ROOM_CREATED:         'private_room_created',
  PRIVATE_ROOM_INVITE_SENT:     'private_room_invite_sent',
  PRIVATE_ROOM_INVITE_RECEIVED: 'private_room_invite_received',
  PRIVATE_ROOM_INVITE_ACCEPTED: 'private_room_invite_accepted',
  PRIVATE_ROOM_BID_PLACED:      'private_room_bid_placed',
  PRIVATE_ROOM_WON:             'private_room_won',

  // ── Checkout & payments ───────────────────────────────────────────────────
  CHECKOUT_STARTED:    'checkout_started',
  PAYMENT_COMPLETED:   'payment_completed',
  ITEM_RECEIVED:       'item_received',
  PAYOUT_RECEIVED:     'payout_received',

  // ── Auth & onboarding ─────────────────────────────────────────────────────
  SIGN_UP:                    'sign_up',
  LOGIN:                      'login',
  EMAIL_VERIFIED:             'email_verified',
  SELLER_ONBOARDING_STARTED:  'seller_onboarding_started',
  PAYOUT_DETAILS_ADDED:       'payout_details_added',
  PAYMENT_METHOD_ADDED:       'payment_method_added',

  // ── Trust & reviews ───────────────────────────────────────────────────────
  REVIEW_LEFT:     'review_left',
  DISPUTE_OPENED:  'dispute_opened',

  // ── Support ───────────────────────────────────────────────────────────────
  SUPPORT_CHAT_OPENED:    'support_chat_opened',
  SUPPORT_REQUEST_SENT:   'support_request_sent',

  // ── Blog ──────────────────────────────────────────────────────────────────
  SHARE_BLOG_POST: 'share_blog_post',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];
export type AnalyticsEventParams = Record<string, string | number | boolean>;
