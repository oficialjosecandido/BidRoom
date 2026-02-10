# Normal Auction vs Best Offer

BidRoom supports two listing formats: **Highest Bid** (normal auction) and **Best Offer**. The seller chooses one when creating a listing. This document explains the differences.

---

## At a glance

| Aspect | Highest Bid (normal auction) | Best Offer |
|--------|------------------------------|------------|
| **Buyer action** | Place **bids** (public, must meet minimum increment) | Submit **offers** (amount + optional message) |
| **Time** | Fixed duration; auction ends at a set time | Listing can have a duration; sale is decided when seller accepts an offer |
| **Who decides** | Time runs out → seller **chooses winner** from bidders (or reopens if no bids) | Seller **accepts or rejects** each offer |
| **Private Room** | Optional: after main auction ends, invited Platinum Bidders can continue bidding | Not used |
| **Buy Now** | Optional: pay Buy Now price to close auction immediately | Not used in the same way |
| **Minimum price** | Optional **reserve price** (hidden; seller can decline to sell if reserve not met) | Optional **minimum offer price** (indication to buyers; seller always **accepts or rejects** manually) |
| **Commission** | 2% if Private Room enabled, else 0.5% | 0.5% |
| **Guests** | Can bid (with email) in main auction; Private Room is authenticated only | Can make offers (with email) |

---

## Highest Bid (normal auction)

- **How it works**
  - Listing has a **starting bid**, **bid increment**, and a **duration** (e.g. 5 minutes, 2 hours, 24 hours, 3 days, 7 days).
  - Buyers place **bids**. Each bid must be at least the **current price + bid increment**.
  - When the **end time** is reached, the auction closes (or a **Private Room** may start if enabled and there are Platinum Bidders).
  - After the auction (and any Private Room) ends, the **seller selects a winner** from the bidders. There is a deadline for the seller to choose.
  - If there were no bids, the seller can **reopen** the listing (e.g. extend by 7 days).

- **Private Room (optional)**
  - If the seller enabled **Private Room**, when the main auction time ends the listing can enter a **Private Room** phase.
  - The seller selects up to **5 Platinum Bidders** (invited bidders). Only they can bid in the Private Room.
  - Each new bid in the Private Room **extends the deadline** (e.g. by 30 seconds).
  - When the Private Room ends, the seller chooses the winner as in a normal auction.

- **Buy Now (optional)**
  - If the seller set a **Buy Now** price, any buyer can pay that price to **close the auction immediately** and win (subject to your payment flow).

- **Reserve price (optional)**
  - A hidden **reserve** can be set. The highest bidder may still not win if the reserve was not met; the seller decides when choosing the winner.

---

## Best Offer

- **How it works**
  - Buyers submit **offers**: an amount and an optional message.
  - Each buyer (or guest email) can have only **one pending offer** per listing; submitting again **updates** that offer.
  - The **seller** can **accept** or **reject** any offer.
  - When the seller **accepts** an offer:
    - The listing is **closed** (status: ended).
    - The listing’s **current price** is set to the accepted offer amount.
    - All other pending offers for that listing are **rejected**.

- **Minimum offer price (optional)**
  - The seller can set a **minimum offer price** as an indication to buyers (e.g. “I won’t accept below €X”). Offers below this may still be submitted; the seller always **accepts or rejects** each offer manually. The listing closes only when the seller accepts an offer.

- **Guests**
  - Buyers can make offers **without logging in** by providing their **email**. The rest of the flow (seller accepts or rejects) is the same.

- **No bids, no Private Room**
  - Best Offer listings do **not** use the bid or Private Room logic. There are no “bids,” no time-based auction, and no Platinum Bidder selection for a private room.

---

## Summary

- **Normal auction (Highest Bid):** Time-limited, public bidding (and optional Private Room), then **seller chooses winner**. Optional Buy Now and reserve.
- **Best Offer:** Buyers send **offers**; **seller accepts or rejects** (no auto-accept). Optional minimum offer price as a guide. No bidding clock or Private Room.

Both formats can have a **duration** on the listing (e.g. for how long the listing is active). In Best Offer, the actual sale is decided when the seller accepts an offer, not automatically when time runs out.
