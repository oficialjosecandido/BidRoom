/** GA4 custom event names (snake_case). Mark key conversions in GA4 Admin → Events. */
export const AnalyticsEvents = {
  BID_MODAL_OPEN: 'bid_modal_open',
  BID_PLACED: 'bid_placed',
  OFFER_MODAL_OPEN: 'offer_modal_open',
  OFFER_PLACED: 'offer_placed',
  BUY_NOW_CLICK: 'buy_now_click',
  BUY_NOW_COMPLETE: 'buy_now_complete',
  WATCHLIST_ADD: 'watchlist_add',
  WATCHLIST_REMOVE: 'watchlist_remove',
  SHARE_LISTING: 'share_listing',
  PRIVATE_ROOM_OPEN: 'private_room_open',
  LISTING_PUBLISHED: 'listing_published',
  SIGN_UP: 'sign_up',
  LOGIN: 'login',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

export type AnalyticsEventParams = Record<string, string | number | boolean>;
