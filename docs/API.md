# Bidroom API Documentation

Base URL: `https://api.bidroom.co/api/v1`

## Authentication

All authenticated endpoints require a Bearer token in the Authorization header:

```
Authorization: Bearer <access_token>
```

## Endpoints

### Authentication

#### `POST /auth/callback`
Azure AD B2C callback endpoint

#### `POST /auth/refresh`
Refresh access token

**Request:**
```json
{
  "refreshToken": "string"
}
```

#### `POST /auth/logout`
Logout user (requires authentication)

#### `GET /auth/profile`
Get current user profile (requires authentication)

---

### Auctions

#### `GET /auctions`
Get list of auctions

**Query Parameters:**
- `page` (number, default: 1)
- `limit` (number, default: 20, max: 100)
- `category` (string)
- `sortBy` (string: endTime, currentBid, totalBids, createdAt)
- `order` (string: asc, desc)
- `minPrice` (number)
- `maxPrice` (number)
- `status` (string)

**Response:**
```json
{
  "auctions": [...],
  "total": 156,
  "page": 1,
  "pages": 8
}
```

#### `GET /auctions/ending-soon`
Get auctions ending soon

**Query Parameters:**
- `limit` (number, default: 10, max: 50)

#### `GET /auctions/promoted`
Get promoted auctions

**Query Parameters:**
- `limit` (number, default: 5, max: 20)

#### `GET /auctions/:id`
Get auction by ID

#### `POST /auctions`
Create new auction (requires authentication)

**Request:**
```json
{
  "title": "string",
  "description": "string",
  "category": "string",
  "startingBid": 100.00,
  "buyNowPrice": 500.00,
  "reservePrice": 300.00,
  "duration": "24h",
  "format": "highest_bid",
  "allowPrivateRoom": true,
  "images": [...]
}
```

#### `PUT /auctions/:id`
Update auction (requires authentication, must be seller)

#### `DELETE /auctions/:id`
Delete auction (requires authentication, must be seller)

---

### Bids

#### `POST /bids`
Place a bid (requires authentication and payment authorization)

**Request:**
```json
{
  "auctionId": "string",
  "amount": 150.00,
  "isAutoBid": false,
  "maxAutoBidAmount": 200.00
}
```

**Response:**
```json
{
  "success": true,
  "bid": {
    "_id": "...",
    "amount": 150.00,
    "bidTime": "2024-01-15T10:30:00Z"
  }
}
```

#### `GET /bids/auction/:auctionId`
Get bids for an auction

**Query Parameters:**
- `page` (number)
- `limit` (number)

#### `GET /bids/user/me`
Get current user's bids (requires authentication)

---

### Users

#### `GET /users/me`
Get current user profile (requires authentication)

#### `PUT /users/me`
Update user profile (requires authentication)

**Request:**
```json
{
  "firstName": "string",
  "lastName": "string",
  "phoneNumber": "string"
}
```

#### `GET /users/me/stats`
Get user statistics (requires authentication)

**Response:**
```json
{
  "totalItemsSold": 12,
  "totalItemsBought": 8,
  "totalValueSold": 5430.00,
  "totalValueBought": 3210.00,
  "totalBidsPlaced": 156,
  "totalAuctionsWon": 8
}
```

#### `GET /users/me/payment-methods`
Get payment methods (requires authentication)

#### `POST /users/me/payment-methods`
Add payment method (requires authentication)

#### `DELETE /users/me/payment-methods/:id`
Remove payment method (requires authentication)

#### `POST /users/me/pre-auth`
Update pre-authorization (requires authentication)

#### `GET /users/me/notifications`
Get notification preferences (requires authentication)

#### `PUT /users/me/notifications`
Update notification preferences (requires authentication)

---

### Watchlist

#### `GET /watchlist`
Get user's watchlist (requires authentication)

#### `POST /watchlist`
Add auction to watchlist (requires authentication)

**Request:**
```json
{
  "auctionId": "string"
}
```

#### `DELETE /watchlist/:auctionId`
Remove from watchlist (requires authentication)

#### `PUT /watchlist/:auctionId`
Update watchlist item (requires authentication)

**Request:**
```json
{
  "notifyOnBid": true,
  "notifyBeforeEnd": true,
  "notifyBeforeEndMinutes": 30
}
```

---

### Transactions

#### `GET /transactions`
Get all user transactions (requires authentication)

#### `GET /transactions/:id`
Get specific transaction (requires authentication)

#### `GET /transactions/selling/me`
Get selling transactions (requires authentication)

#### `GET /transactions/buying/me`
Get buying transactions (requires authentication)

---

### Disputes

#### `GET /disputes`
Get user's disputes (requires authentication)

#### `GET /disputes/:id`
Get specific dispute (requires authentication)

#### `POST /disputes`
Create dispute (requires authentication)

**Request:**
```json
{
  "transactionId": "string",
  "reason": "item_not_as_described",
  "description": "string"
}
```

#### `POST /disputes/:id/messages`
Add message to dispute (requires authentication)

**Request:**
```json
{
  "message": "string"
}
```

#### `POST /disputes/:id/evidence`
Upload evidence (requires authentication)

---

## WebSocket Events

Connect to: `wss://api.bidroom.co`

### Client → Server Events

#### `auction:join`
Join an auction room to receive real-time updates
```javascript
socket.emit('auction:join', auctionId);
```

#### `auction:leave`
Leave an auction room
```javascript
socket.emit('auction:leave', auctionId);
```

#### `bid:place`
Place a bid via WebSocket
```javascript
socket.emit('bid:place', {
  auctionId: 'string',
  amount: 150.00
});
```

#### `auction:watch`
Add auction to watchlist
```javascript
socket.emit('auction:watch', auctionId);
```

#### `auction:unwatch`
Remove auction from watchlist
```javascript
socket.emit('auction:unwatch', auctionId);
```

### Server → Client Events

#### `auction:state`
Current auction state
```javascript
socket.on('auction:state', (data) => {
  // data: { currentBid, totalBids, endTime, ... }
});
```

#### `bid:new`
New bid placed on auction
```javascript
socket.on('bid:new', (data) => {
  // data: { bidId, amount, totalBids, timestamp }
});
```

#### `bid:success`
Bid placed successfully
```javascript
socket.on('bid:success', (data) => {
  // data: { bidId, amount, auctionId }
});
```

#### `bid:error`
Bid error
```javascript
socket.on('bid:error', (data) => {
  // data: { message, minBid }
});
```

#### `notification`
Real-time notification
```javascript
socket.on('notification', (data) => {
  // data: { type, title, message, ... }
});
```

---

## Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "message": "Error message"
}
```

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `429` - Too Many Requests
- `500` - Internal Server Error

---

## Rate Limiting

- General API: 100 requests per 15 minutes
- Authentication: 5 requests per 15 minutes
- Bidding: 10 bids per minute
- Uploads: 50 uploads per hour

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

---

## Pagination

Paginated endpoints return:

```json
{
  "data": [...],
  "pagination": {
    "total": 156,
    "page": 1,
    "pages": 8,
    "limit": 20
  }
}
```

---

## Filtering & Sorting

Use query parameters for filtering and sorting:

```
GET /auctions?category=electronics&sortBy=endTime&order=asc&minPrice=50&maxPrice=500
```

