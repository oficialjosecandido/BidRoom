# Infrastructure Capacity Review — 1,000 Bids/Day

**Date:** 2026-05-06  
**Scope:** Bid submission path end-to-end (rate limiting → Express → MongoDB → Redis → Socket.io)  
**Verdict: Ready. No blocking changes required.**

---

## Load profile

| Metric | Value |
|---|---|
| Bids per day | 1,000 |
| Average rate | ~42/hour · ~0.7/min |
| Realistic burst | ~50 bids in the last 5 min of a hot auction |

---

## What's in good shape

| Layer | Implementation | Assessment |
|---|---|---|
| **Global rate limit** | `bidOfferLimiter`: 30 req/min per IP (`express-rate-limit`) | Average load is 0.7/min — well under the cap |
| **Per-user rate limit** | 6 bids/min authenticated, 3/min guest (`bidRateLimiter.js`) | Comfortable headroom at this volume |
| **DB indexes** | `{ listing, createdAt }`, `{ listing, amount }`, `{ bidder, createdAt }` on Bid | All hot queries in the bid route are covered |
| **Redis caching** | Write-through on every bid: current price, stats, bid object (TTL 24h / 1h) | Reduces repeat reads on listing pages; non-blocking (fire-and-forget) |
| **Real-time** | Socket.io + Redis pub/sub adapter | Multi-instance ready; events fan out correctly across processes |
| **MongoDB** | Atlas SRV with DNS fallback, Mongoose default pool (5 connections) | Atlas handles 1k writes/day trivially; pool saturation starts at ~5 concurrent requests |
| **Auth & guards** | Fraud checks, KYC threshold ($5k+), own-listing block, dispute restriction | All run synchronously before the bid is saved — correct ordering |

---

## Three things to fix before you grow

### 1. In-memory bid rate limiter breaks under horizontal scale

**File:** [`backend/src/middleware/bidRateLimiter.js`](../backend/src/middleware/bidRateLimiter.js)

The per-user limit counter lives in a `new Map()` inside each Node.js process. If you ever run 2+ instances (Azure slots, PM2 cluster, container replicas), each has its own map — a user effectively gets `6 × N` bids/min.

**Fix when needed:** Replace the `Map` with a Redis `INCR` + `EXPIRE` pattern:

```js
const count = await redis.incr(`bid-rate:${key}`);
if (count === 1) await redis.expire(`bid-rate:${key}`, 60);
if (count > max) return { allowed: false };
```

**Priority:** Low — not relevant until you run more than one process.

---

### 2. `Bid.countDocuments` on every write is a full index scan

**File:** [`backend/src/routes/bids.js:450`](../backend/src/routes/bids.js)

```js
listing.bidCount = await Bid.countDocuments({ listing: listingId });
```

This is correct but re-counts every bid on every write. A `$inc` on the listing document inside a `findOneAndUpdate` would be O(1) instead of O(bids).

**Fix when needed:**

```js
await Listing.findByIdAndUpdate(listingId, { $inc: { bidCount: 1 }, $set: { currentPrice: amount } });
```

**Priority:** Low — only matters when a single listing accumulates 500+ bids.

---

### 3. Concurrent bids on the same listing are not atomic

**File:** [`backend/src/routes/bids.js`](../backend/src/routes/bids.js) — the `listing.save()` pattern

Two bids arriving within the same millisecond both read the same `listing.currentPrice`, both pass the minimum-bid validation, and one will silently overwrite the other's update. The lower bid could win if it saves last.

**Fix before running a high-profile auction:**

Replace the read-validate-save sequence with a single atomic update that only applies if the incoming amount is still the highest:

```js
const updated = await Listing.findOneAndUpdate(
  { _id: listingId, currentPrice: { $lt: amount } },
  { $set: { currentPrice: amount }, $inc: { bidCount: 1 } },
  { new: true }
);
if (!updated) {
  return res.status(409).json({ error: 'Outbid', message: 'A higher bid was placed at the same time.' });
}
```

**Priority:** Medium — negligible at 1k bids/day, becomes real during competitive last-minute bidding on a popular item.

---

## Summary

| Issue | Impact at 1k/day | Priority |
|---|---|---|
| In-memory rate limiter | None (single instance) | Fix before horizontal scale |
| `countDocuments` on every bid | Negligible | Fix before high-bid-count listings |
| Non-atomic `listing.save()` | Negligible | Fix before high-traffic auction events |

At 1,000 bids/day the system runs well within all limits. The three items above are backlog tasks, not blockers.
