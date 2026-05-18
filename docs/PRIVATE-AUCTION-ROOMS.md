# Private Auction Rooms

This document explains how **Private Auction Rooms** work in BidRoom: when they are available, how the seller creates and runs a room, how bidders are invited and participate, and how the winner is determined.

---

## Overview

Private rooms are an **optional** feature for **Highest Bid** (normal auction) listings. When the main auction ends with bids and the reserve (if any) is met, the seller can create a **Private Auction Room** and invite 2–5 bidders. Only those **Platinum Bidders** (invitees who accept in time) can place bids in the room. The room runs until **60 seconds pass with no new bid**; the **highest bid at that moment wins automatically**—the seller does **not** choose the winner.

---

## Product rules (timing, invitations, and room UI)

These rules define the intended behavior for the private room lifecycle, listing page, and room experience.

### After the main auction ends

- The seller has **15 minutes** to invite people to the private room.
- The **listing page** shows a **countdown** for this window so the seller and viewers see how much time remains to create the room and send invitations.

### Invitations

- The seller may invite **up to 5** bidders (and at least **2**, when a private room is used—see eligibility above).
- Each invited bidder must **accept or refuse** within **15 minutes** of being invited. If they do not respond within that period, they are **no longer eligible** for the room.

### Edge case: exactly two invitees, one does not respond

- If **only two** people are invited and **one** of them does not accept (or respond) within the **15-minute** window, the **other invitee is selected as the winner** of the private room (no need to run the usual bidding duel between two active participants in that scenario).

### Public access and “poker table” room UI

- Once the private room **exists** (has been created), **anyone** may **open and view** it—it is not restricted to invitees only for viewing.
- The room shows a **poker-table–style** layout:
  - **Invitees who have not accepted** (or have refused) appear **greyed out**.
  - **Invitees who have accepted** appear **highlighted** (active seats).
- The UI also shows a **countdown until the private auction opens** (starts).

### When everyone accepts early

- When **all** invited people have **accepted**, the wait until the auction opens is **reduced to 1 minute** (instead of waiting for the full invitation window to expire).

### Bidding phase

- After the room opens, the private auction behaves like the **existing** private-room auction: only accepted invitees can bid; the **60 seconds after the last bid** rule applies; the **highest bidder** when the room closes wins automatically.

---

## When is a private room available?

- The listing must be **Highest Bid** (not Best Offer).
- **Private Room** must be **enabled** when the listing is created.
- The **main auction** must have **ended** (end time reached).
- There must be **at least one bid** and, if set, the **reserve price** must be **met**.
- There must be **at least 2 unique authenticated bidders** (private room requires inviting 2–5; only registered bidders can be invited).

When these conditions are met, the listing becomes **eligible** for a private room and the seller receives an email asking them to create the room.

**If there is only one authenticated bidder**, a private room cannot be created (minimum 2 required). The auction closes with that single bidder as the **winner** automatically—same as a regular auction end.

---

## Time limits

| Rule | Time |
|------|------|
| **Seller: create the room and send invitations** | Within **15 minutes** after the main auction ends. The listing page shows a **countdown** for this window. After it expires, the option to create a private room is no longer available. |
| **Invited bidders: accept or refuse** | Within **15 minutes** after invitations are sent. If a bidder does not respond in time, they are **no longer eligible** for the room. |
| **Opening the private auction (all invitees accepted)** | When **every** invited bidder has **accepted**, the countdown to open the auction is **reduced to 1 minute**. |
| **Room end (bidding phase)** | After the room is open for bidding, it closes **60 seconds** after the **last bid**. Each new bid extends the countdown by 60 seconds from that bid’s time. |

---

## Flow (step by step)

### 1. Main auction ends

- When the main auction end time is reached, the system:
  - Marks the listing as **ended**.
  - If private room is enabled, there are bids, reserve is met, **and there are at least 2 unique authenticated bidders**:
    - Sets the listing to **eligible** for a private room.
    - Sets a **15-minute** deadline for the seller to create the room and invite bidders (surfaced on the **listing page** as a countdown).
    - Sends the **seller** an email: “Create private room” (with a link to the listing).
  - If private room is enabled but there is **only one authenticated bidder**, the single bidder is **auto-selected as winner**—no private room; auction closes normally.

### 2. Seller creates the room and invites bidders

- On the **listing page**, the seller sees a **“Create private room”** option (only while the **15-minute** invite window is open), with a visible **countdown**. The seller cannot select a winner manually when private room is enabled—they must create the room instead.
- The seller selects **between 2 and 5 bidders** from the main auction (only **registered** bidders can be invited; guest bidders are not eligible).
- On confirmation:
  - The listing’s **private room** is created and set to **invited** (waiting for acceptances or refusals). The **listing page** and **room** show who was invited, the **poker-table** layout, and a **countdown until the private auction opens** (see [Product rules](#product-rules-timing-invitations-and-room-ui)).
  - Each invited bidder gets an email with **accept / refuse** actions (valid for **15 minutes**).
  - **Opening:** When **all** invitees have **accepted**, the countdown to open the auction **drops to 1 minute**. If some invitees have not yet responded, the auction opens according to the configured window (typically when the **15-minute** response period ends, unless a two-invitee winner is determined first—see step 3).
  - Bidders who were **not** invited receive a “You were not invited to the private room” email.

### 3. Invited bidders accept, refuse, or time out

- Each invitee must **accept or refuse** the invitation (e.g. via the link in the email) **within 15 minutes**.
- If they **accept** in time, they become **Platinum Bidders** for that room and can place bids once the room has started.
- If they **refuse** or **do not respond** in time, they are **no longer eligible** for the room (they lose their seat and cannot bid).
- **Edge case (exactly two invitees):** If **one** of the two does not respond within 15 minutes, the **other invitee is selected as the winner** of the private room.
- **If no one accepts** (and the two-invitee edge case does not apply): When the invitation window expires and **no invited bidder** has accepted, the auction is **closed without a winner**. The seller and invited buyers receive email and in-app notifications as implemented.

### 4. Viewing the room before and during bidding

- Once the private room **exists**, **anyone** can **open and view** it (not only invitees).
- The UI uses a **poker-table** metaphor: not-yet-accepted invitees are **greyed out**; accepted invitees are **highlighted**. A **countdown to when the private auction opens** is always visible during the invitation / pre-start phase.
- When **all** invited users have **accepted**, the countdown to open the auction **shortens to 1 minute** (see [Product rules](#product-rules-timing-invitations-and-room-ui)).

### 5. Bidding in the room

- Only **Platinum Bidders** (invitees who accepted in time) can place bids in the private room.
- Spectators can watch; only accepted invitees can bid.
- Each **new bid**:
  - Updates the current price and bid count.
  - **Extends the room end time** to **60 seconds from that bid**.
- So the room stays open as long as bidding continues; it closes when **60 seconds pass with no new bid**.

### 6. Room ends: winner is automatic

- **Two invitees, one did not respond in time:** The **responding invitee is selected as the winner** (no bidding phase required for that outcome).
- **Normal case (bidding):** When the **60 seconds** run out after the last bid, the system:
  - **Closes** the room (`privateRoomStatus` → `ended`).
  - Sets the **winner** to the **highest bidder** at that moment (the bid that was not outbid for 60 seconds).
  - Creates a **Transaction** (for payment/shipping tracking).
  - Sends email to the **winner** (“You won the private room” – highest bid not outbid for 60 seconds).
  - Sends email to **other bidders** (“Private room closed – another bidder won”).
  - Sends the **seller** a “Choose winner”–style notification (for awareness; the winner is already set).

**Important:** For private rooms, the **seller does not choose the winner**. The listing page does **not** show “Select winner” or “Select as winner” when the private room has ended; the winner was already determined by the **60-second bidding rule** or, when **only two were invited and one did not respond in time**, by **automatic selection** of the other invitee.

### 7. After the room ends

- **Winner** and **seller** see the listing under **Dashboard → Transactions** (payment and shipping).
- The **listing page** shows “Private room closed” and, for the seller, “Winner has been selected” (no manual selection).

---

## States of a listing (private room)

| State | Meaning |
|-------|--------|
| `not-triggered` | Main auction not ended yet, or private room not enabled. |
| `eligible` | Main auction ended with bids and reserve met; seller has **15 minutes** to create the room and invite 2–5 bidders (countdown on listing). **Select winner** is not shown—only **Create private room**. |
| `invited` | Room created; invitees have **15 minutes** to accept or refuse. Not yet open for bidding; UI shows poker-table seats, countdown to open, and **1-minute** start when **all** have accepted. |
| `active` | Private room is running; only accepted Platinum Bidders can bid; room ends **60 seconds** after the last bid. |
| `ended` | Private room has closed. Either: (a) winner is the highest bid not outbid for 60 seconds; (b) two invitees and one timed out → the other wins; (c) no one accepted in time (where applicable), so there is no winner; or (d) the seller left the room. |

---

## Seller leaves the private room

If the **seller** leaves the private room (navigates away, closes the tab, or explicitly leaves) while the room is **invited** or **active**:

1. The system **automatically closes** the room (`privateRoomStatus` → `ended`, `privateRoomClosedReason` → `seller_left`).
2. **Buyers** inside the room receive a clear notification (email + in-app) explaining that the seller has left and the auction has been closed.
3. **No further bids** can be submitted; the room is closed.
4. **Bids remain** for audit/history; no winner is declared and no transaction is created.
5. The event is **logged** in `PrivateRoomAuditLog` for audit purposes.

---

## Emails

- **Seller:** “Create private room” (when auction ends and room is eligible).
- **Invited bidders:** “Platinum bidder invitation” with **Accept** and **Refuse** (15 min to respond).
- **Not invited:** “You were not invited to the private room.”
- **When room ends:**  
  - **Winner:** “You won the private room” (highest bid not outbid for 60 seconds).  
  - **Others:** “Private room closed – another bidder won.”

---

## Summary

- Private rooms are **optional** and only for **Highest Bid** listings with private room enabled.
- **Seller** must create the room **within 15 minutes** of the main auction ending (countdown on the listing) and invite **2–5** registered bidders.
- **Invitees** must **accept or refuse within 15 minutes** or lose eligibility. **Two invitees, one no-show:** the other is **selected as winner**. If **no one** accepts (other cases), the auction may close without a winner as specified above.
- **Room UI:** Poker-table layout; **anyone** can view; pending invitees **greyed out**, accepted **highlighted**; countdown until the auction **opens**; **1-minute** start when **all** have accepted.
- Only **accepted invitees** can bid; each bid **extends the room by 60 seconds**.
- When **60 seconds pass with no new bid**, the room closes and the **highest bidder wins automatically**—**no seller choice**.
- If the **seller leaves** the room (invited or active), the room closes immediately with no winner; all participants are notified.
- Winner and seller then use **Transactions** for payment and shipping.
