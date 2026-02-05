# Private Auction Rooms

This document explains how **Private Auction Rooms** work in BidRoom: when they are available, how the seller creates and runs a room, how bidders are invited and participate, and how the winner is determined.

---

## Overview

Private rooms are an **optional** feature for **Highest Bid** (normal auction) listings. When the main auction ends with bids and the reserve (if any) is met, the seller can create a **Private Auction Room** and invite 2–5 bidders. Only those **Platinum Bidders** (invitees who accept in time) can place bids in the room. The room runs until **60 seconds pass with no new bid**; the **highest bid at that moment wins automatically**—the seller does **not** choose the winner.

---

## When is a private room available?

- The listing must be **Highest Bid** (not Best Offer).
- **Private Room** must be **enabled** when the listing is created.
- The **main auction** must have **ended** (end time reached).
- There must be **at least one bid** and, if set, the **reserve price** must be **met**.

When these conditions are met, the listing becomes **eligible** for a private room and the seller receives an email asking them to create the room.

---

## Time limits

| Rule | Time |
|------|------|
| **Seller: create the room** | Within **1 hour** after the main auction ends. After that, the option to create a private room is no longer available. |
| **Invited bidders: accept invitation** | Within **30 minutes** after the room is created. If a bidder does not accept in time, they lose their seat and cannot bid in the room. |
| **Room end** | The room closes **60 seconds** after the **last bid**. Each new bid extends the countdown by 60 seconds from that bid’s time. |

---

## Flow (step by step)

### 1. Main auction ends

- When the main auction end time is reached, the system:
  - Marks the listing as **ended**.
  - If private room is enabled, there are bids, and reserve is met:
    - Sets the listing to **eligible** for a private room.
    - Sets a **1 hour** deadline for the seller to create the room.
    - Sends the **seller** an email: “Create private room” (with a link to the listing).

### 2. Seller creates the room and invites bidders

- On the **listing page**, the seller sees a **“Create private room”** option (only while the 1 hour window is open).
- The seller selects **between 2 and 5 bidders** from the main auction (only **registered** bidders can be invited; guest bidders are not eligible).
- On confirmation:
  - The listing’s **private room** is created and set to **active**.
  - Each invited bidder gets an email with an **“Accept & Join Room”** link (valid for **30 minutes**).
  - The room’s first **end time** is set to **60 seconds** from creation (seller can then “Start auction” so the countdown is visible; the room still closes 60 seconds after the last bid).
  - Bidders who were **not** invited receive a “You were not invited to the private room” email.

### 3. Invited bidders accept (or lose their seat)

- Each invitee must **accept** the invitation (via the link in the email) **within 30 minutes**.
- If they accept in time, they become **Platinum Bidders** for that room and can place bids.
- If they do **not** accept in time, they lose their seat and cannot bid in that room.

### 4. Bidding in the room

- Only **Platinum Bidders** (invitees who accepted in time) can place bids in the private room.
- Anyone can **watch** the room (viewer count is shown); only accepted invitees can bid.
- Each **new bid**:
  - Updates the current price and bid count.
  - **Extends the room end time** to **60 seconds from that bid**.
- So the room stays open as long as bidding continues; it closes when **60 seconds pass with no new bid**.

### 5. Room ends: winner is automatic

- When the **60 seconds** run out (no new bid), the system:
  - **Closes** the room (`privateRoomStatus` → `ended`).
  - Sets the **winner** to the **highest bidder** at that moment (the bid that was not outbid for 60 seconds).
  - Creates a **Transaction** (for payment/shipping tracking).
  - Sends email to the **winner** (“You won the private room” – highest bid not outbid for 60 seconds).
  - Sends email to **other bidders** (“Private room closed – another bidder won”).
  - Sends the **seller** a “Choose winner”–style notification (for awareness; the winner is already set).

**Important:** For private rooms, the **seller does not choose the winner**. The listing page does **not** show “Select winner” or “Select as winner” when the private room has ended; the winner was already determined by the 60-second rule.

### 6. After the room ends

- **Winner** and **seller** see the listing under **Dashboard → Transactions** (payment and shipping).
- The **listing page** shows “Private room closed” and, for the seller, “Winner has been selected” (no manual selection).

---

## States of a listing (private room)

| State | Meaning |
|-------|--------|
| `not-triggered` | Main auction not ended yet, or private room not enabled. |
| `eligible` | Main auction ended with bids and reserve met; seller has **1 hour** to create the room and invite 2–5 bidders. |
| `active` | Private room is running; only accepted Platinum Bidders can bid; room ends **60 seconds** after the last bid. |
| `ended` | Private room has closed; winner is the highest bid not outbid for 60 seconds; no seller choice. |

---

## Emails

- **Seller:** “Create private room” (when auction ends and room is eligible).
- **Invited bidders:** “Platinum bidder invitation” with **Accept** link (30 min to accept).
- **Not invited:** “You were not invited to the private room.”
- **When room ends:**  
  - **Winner:** “You won the private room” (highest bid not outbid for 60 seconds).  
  - **Others:** “Private room closed – another bidder won.”

---

## Summary

- Private rooms are **optional** and only for **Highest Bid** listings with private room enabled.
- **Seller** must create the room **within 1 hour** of the main auction ending and invite **2–5** registered bidders.
- **Invitees** must **accept within 30 minutes** or lose their seat.
- Only **accepted invitees** can bid; each bid **extends the room by 60 seconds**.
- When **60 seconds pass with no new bid**, the room closes and the **highest bidder wins automatically**—**no seller choice**.
- Winner and seller then use **Transactions** for payment and shipping.
