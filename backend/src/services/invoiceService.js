const PDFDocument = require('pdfkit');

// ─── Constants ────────────────────────────────────────────────────────────────

const BIDROOMFEE_RATE = 0.035; // 3.5%
const MARGIN = 50;
const CONTENT_WIDTH = 495; // A4 width 595 − 2 × 50

const COLORS = {
  text:        '#1a1a1a',
  muted:       '#777777',
  light:       '#f5f5f5',
  accent:      '#e53e3e',
  white:       '#ffffff',
  purple:      '#7A4F84',
  sellerGreen: '#2e7d32',
  buyerBlue:   '#1565c0'
};

// ─── Financial helpers ────────────────────────────────────────────────────────

/** Format amount as USD string */
function formatUsd(amount) {
  return '$' + Number(amount).toFixed(2);
}

/** BidRoom platform fee: stored on transaction when paid via Stripe, fallback to rate */
function getBidRoomFee(transaction) {
  if (transaction.bidRoomFeeAmount != null) return transaction.bidRoomFeeAmount;
  const rate = transaction.listing?.commissionRate ?? BIDROOMFEE_RATE;
  return transaction.amount * rate;
}

/** Stripe processing fee: stored after payment capture; null if not yet available */
function getStripeFee(transaction) {
  return transaction.stripeFeeAmount ?? null;
}

/**
 * Shipping amount:
 *  - Uses transaction.shippingAmount if available (locked calculated rate or post-payment stored value)
 *  - Falls back to flat-rate listing.shippingCost
 *  - Returns 0 for free / local-pickup
 *  - Returns null when calculated shipping has not yet been locked
 */
function getShippingAmount(transaction) {
  if (transaction.shippingAmount != null) return transaction.shippingAmount;
  const opt = transaction.listing?.shippingOption || 'flat-rate';
  if (opt === 'free' || opt === 'local-pickup') return 0;
  if (opt === 'flat-rate') return transaction.listing?.shippingCost ?? 0;
  return null; // calculated but not yet locked
}

/** Shipping display label including carrier/service when available */
function getShippingLabel(transaction) {
  const shipping = getShippingAmount(transaction);
  if (shipping === null) return 'TBD';
  if (shipping === 0) return 'Free';
  const parts = [formatUsd(shipping)];
  if (transaction.shippingCarrier) parts.push(`via ${transaction.shippingCarrier}`);
  if (transaction.shippingService)  parts.push(`(${transaction.shippingService})`);
  return parts.join(' ');
}

/** Seller payout: stored on transaction when paid; fallback to calculated */
function getSellerPayout(transaction) {
  if (transaction.sellerPayoutAmount != null) return transaction.sellerPayoutAmount;
  const fee = getBidRoomFee(transaction);
  const stripeFee = getStripeFee(transaction) ?? 0;
  return transaction.amount - fee - stripeFee;
}

/** Buyer total charged (item + BidRoom fee + shipping) */
function getBuyerTotal(transaction) {
  if (transaction.buyerTotalPaid != null) return transaction.buyerTotalPaid;
  const bidRoomFee = getBidRoomFee(transaction);
  const shipping = getShippingAmount(transaction);
  return shipping !== null ? transaction.amount + bidRoomFee + shipping : null;
}

// ─── PDF drawing helpers ──────────────────────────────────────────────────────

function formatDate(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function drawHorizontalLine(doc, y) {
  doc.save()
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + CONTENT_WIDTH, y)
    .strokeColor('#cccccc')
    .lineWidth(0.5)
    .stroke()
    .restore();
}

/** Legacy thin rule used by simple text section */
function drawRule(doc, y) {
  drawHorizontalLine(doc, y);
}

function drawSectionTitle(doc, title, y) {
  doc.save()
    .rect(MARGIN, y, CONTENT_WIDTH, 20)
    .fill(COLORS.light)
    .restore();
  doc.save()
    .fillColor(COLORS.text)
    .fontSize(9)
    .font('Helvetica-Bold')
    .text(title.toUpperCase(), MARGIN + 6, y + 6)
    .restore();
  return y + 26;
}

function drawKeyValue(doc, label, value, y, { bold = false, valueColor = COLORS.text } = {}) {
  doc.save()
    .fillColor(COLORS.muted)
    .fontSize(9)
    .font('Helvetica')
    .text(label, MARGIN, y)
    .restore();
  doc.save()
    .fillColor(valueColor)
    .fontSize(9)
    .font(bold ? 'Helvetica-Bold' : 'Helvetica')
    .text(value, MARGIN + 180, y, { width: CONTENT_WIDTH - 180, align: 'right' })
    .restore();
  return y + 16;
}

function drawBreakdownRow(doc, label, value, y, { bold = false, highlight = false, valueColor = COLORS.text } = {}) {
  if (highlight) {
    doc.save()
      .rect(MARGIN, y - 4, CONTENT_WIDTH, 22)
      .fill(COLORS.light)
      .restore();
  }
  doc.save()
    .fillColor(bold ? COLORS.text : COLORS.muted)
    .fontSize(9.5)
    .font(bold ? 'Helvetica-Bold' : 'Helvetica')
    .text(label, MARGIN + 6, y + 1)
    .restore();
  doc.save()
    .fillColor(valueColor)
    .fontSize(9.5)
    .font(bold ? 'Helvetica-Bold' : 'Helvetica')
    .text(value, MARGIN, y + 1, { width: CONTENT_WIDTH - 6, align: 'right' })
    .restore();
  return y + 18;
}

function drawTotalRow(doc, label, value, y, color) {
  doc.save()
    .rect(MARGIN, y - 4, CONTENT_WIDTH, 28)
    .fill(color)
    .restore();
  doc.save()
    .fillColor(COLORS.white)
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(label, MARGIN + 10, y + 3)
    .restore();
  doc.save()
    .fillColor(COLORS.white)
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(value, MARGIN, y + 3, { width: CONTENT_WIDTH - 10, align: 'right' })
    .restore();
  return y + 32;
}

function drawFooter(doc) {
  const y = doc.page.height - 50;
  drawHorizontalLine(doc, y);
  doc.save()
    .fillColor(COLORS.muted)
    .fontSize(8)
    .font('Helvetica')
    .text(
      'BidRoom Auction Marketplace  •  This document is generated automatically and is for record-keeping purposes.',
      MARGIN,
      y + 8,
      { width: CONTENT_WIDTH, align: 'center' }
    )
    .restore();
}

// ─── Seller Invoice PDF ────────────────────────────────────────────────────────

async function buildSellerInvoicePdf(transaction) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const bidRoomFee   = getBidRoomFee(transaction);
    const stripeFee    = getStripeFee(transaction);
    const shipping     = getShippingAmount(transaction);
    const sellerPayout = getSellerPayout(transaction);
    const listing      = transaction.listing || {};
    const seller       = transaction.seller  || {};
    const buyer        = transaction.buyer   || {};
    const sellerName   = [seller.firstName, seller.lastName].filter(Boolean).join(' ') || 'N/A';
    const buyerName    = [buyer.firstName, buyer.lastName].filter(Boolean).join(' ') || 'N/A';
    const commissionRate = ((listing.commissionRate ?? BIDROOMFEE_RATE) * 100).toFixed(1) + '%';
    const platformFee    = getBidRoomFee(transaction);
    const salePriceLabel = listing.auctionFormat === 'best-offer' ? 'Accepted offer price' : 'Final auction price';

    // ── Header ────────────────────────────────────────────────────────────────
    doc.save()
      .rect(MARGIN, 40, CONTENT_WIDTH, 50)
      .fill(COLORS.purple)
      .restore();
    doc.save()
      .fillColor(COLORS.white)
      .fontSize(22)
      .font('Helvetica-Bold')
      .text('Seller Invoice', MARGIN + 12, 52)
      .restore();
    doc.save()
      .fillColor(COLORS.white)
      .fontSize(10)
      .font('Helvetica')
      .text('BidRoom Auction Marketplace', MARGIN, 52, { width: CONTENT_WIDTH, align: 'right' })
      .restore();

    let y = 108;

    // ── Transaction meta ──────────────────────────────────────────────────────
    y = drawSectionTitle(doc, 'Transaction Details', y);
    y = drawKeyValue(doc, 'Transaction ID', String(transaction._id), y);
    y = drawKeyValue(doc, 'Date', formatDate(transaction.paidAt || transaction.updatedAt || transaction.createdAt), y);
    if (transaction.stripePaymentIntentId) {
      y = drawKeyValue(doc, 'Payment reference', transaction.stripePaymentIntentId, y);
    }
    y = drawKeyValue(doc, 'Item', listing.title || 'N/A', y);
    y += 10;

    // ── Parties ───────────────────────────────────────────────────────────────
    y = drawSectionTitle(doc, 'Parties', y);
    y = drawKeyValue(doc, 'Seller (you)', sellerName, y, { bold: true });
    if (seller.email) y = drawKeyValue(doc, 'Seller email', seller.email, y);
    y = drawKeyValue(doc, 'Buyer', buyerName, y);
    if (buyer.email)  y = drawKeyValue(doc, 'Buyer email', buyer.email, y);
    y += 10;

    // ── Payment Breakdown ─────────────────────────────────────────────────────
    y = drawSectionTitle(doc, 'Payment Breakdown', y);

    y = drawBreakdownRow(doc, salePriceLabel, formatUsd(transaction.amount), y);
    y = drawBreakdownRow(doc, `Shipping (${listing.shippingOption || 'flat-rate'})`, getShippingLabel(transaction), y);
    y = drawBreakdownRow(doc, 'Taxes / VAT', '$0.00', y);
    y += 4;
    drawHorizontalLine(doc, y);
    y += 8;
    y = drawBreakdownRow(doc, `BidRoom platform fee (${commissionRate} of sale price)`, `- ${formatUsd(platformFee)}`, y, { valueColor: COLORS.accent });
    if (stripeFee !== null) {
      y = drawBreakdownRow(doc, 'Stripe processing fee (~2.9% + $0.30)', `- ${formatUsd(stripeFee)}`, y, { valueColor: COLORS.accent });
    } else {
      y = drawBreakdownRow(doc, 'Stripe processing fee', '– see Stripe dashboard', y, { valueColor: COLORS.muted });
    }
    y += 10;

    y = drawTotalRow(doc, 'Final payout to you (seller)', formatUsd(sellerPayout), y, COLORS.sellerGreen);
    y += 14;

    // ── Shipping details (calculated shipping) ────────────────────────────────
    if (listing.shippingOption === 'calculated' && transaction.shippingCarrier) {
      y = drawSectionTitle(doc, 'Shipping Details', y);
      y = drawKeyValue(doc, 'Carrier', transaction.shippingCarrier, y);
      if (transaction.shippingService)   y = drawKeyValue(doc, 'Service', transaction.shippingService, y);
      if (transaction.shippingDeliveryDays) y = drawKeyValue(doc, 'Est. delivery', `${transaction.shippingDeliveryDays} business days`, y);
      y += 10;
    }

    // ── Notes ─────────────────────────────────────────────────────────────────
    doc.save()
      .fillColor(COLORS.muted)
      .fontSize(8)
      .font('Helvetica')
      .text(
        `Commission rate applied: ${commissionRate}. Platform fee is deducted from the sale price at transaction completion.`,
        MARGIN,
        y,
        { width: CONTENT_WIDTH }
      )
      .restore();

    drawFooter(doc);
    doc.end();
  });
}

// ─── Buyer Receipt PDF ─────────────────────────────────────────────────────────

async function buildBuyerInvoicePdf(transaction) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const bidRoomFee = getBidRoomFee(transaction);
    const shipping   = getShippingAmount(transaction);
    const buyerTotal = getBuyerTotal(transaction);
    const listing    = transaction.listing || {};
    const seller     = transaction.seller  || {};
    const buyer      = transaction.buyer   || {};
    const sellerName = [seller.firstName, seller.lastName].filter(Boolean).join(' ') || 'N/A';
    const buyerName  = [buyer.firstName, buyer.lastName].filter(Boolean).join(' ') || 'N/A';
    const commissionRate = ((listing.commissionRate ?? BIDROOMFEE_RATE) * 100).toFixed(1) + '%';
    const platformFee    = getBidRoomFee(transaction);
    const salePriceLabel = listing.auctionFormat === 'best-offer' ? 'Accepted offer price' : 'Final auction price';
    const totalLabel     = buyerTotal !== null ? formatUsd(buyerTotal) : `${formatUsd(transaction.amount + bidRoomFee)} + shipping`;

    // ── Header ────────────────────────────────────────────────────────────────
    doc.save()
      .rect(MARGIN, 40, CONTENT_WIDTH, 50)
      .fill(COLORS.buyerBlue)
      .restore();
    doc.save()
      .fillColor(COLORS.white)
      .fontSize(22)
      .font('Helvetica-Bold')
      .text('Purchase Receipt', MARGIN + 12, 52)
      .restore();
    doc.save()
      .fillColor(COLORS.white)
      .fontSize(10)
      .font('Helvetica')
      .text('BidRoom Auction Marketplace', MARGIN, 52, { width: CONTENT_WIDTH, align: 'right' })
      .restore();

    let y = 108;

    // ── Transaction meta ──────────────────────────────────────────────────────
    y = drawSectionTitle(doc, 'Transaction Details', y);
    y = drawKeyValue(doc, 'Transaction ID', String(transaction._id), y);
    y = drawKeyValue(doc, 'Date', formatDate(transaction.paidAt || transaction.updatedAt || transaction.createdAt), y);
    if (transaction.stripePaymentIntentId) {
      y = drawKeyValue(doc, 'Payment reference', transaction.stripePaymentIntentId, y);
    }
    y = drawKeyValue(doc, 'Item', listing.title || 'N/A', y);
    y += 10;

    // ── Parties ───────────────────────────────────────────────────────────────
    y = drawSectionTitle(doc, 'Parties', y);
    y = drawKeyValue(doc, 'Buyer (you)', buyerName, y, { bold: true });
    if (buyer.email)  y = drawKeyValue(doc, 'Buyer email', buyer.email, y);
    y = drawKeyValue(doc, 'Seller', sellerName, y);
    if (seller.email) y = drawKeyValue(doc, 'Seller email', seller.email, y);
    y += 10;

    // ── Payment Breakdown ─────────────────────────────────────────────────────
    y = drawSectionTitle(doc, 'Payment Breakdown', y);

    y = drawBreakdownRow(doc, salePriceLabel, formatUsd(transaction.amount), y);
    y = drawBreakdownRow(doc, `BidRoom platform fee (${commissionRate}, included in price)`, formatUsd(platformFee), y, { valueColor: COLORS.muted });
    y = drawBreakdownRow(doc, `Shipping (${listing.shippingOption || 'flat-rate'})`, getShippingLabel(transaction), y);
    y = drawBreakdownRow(doc, 'Taxes / VAT', '$0.00', y);
    y += 4;
    drawHorizontalLine(doc, y);
    y += 12;

    y = drawTotalRow(doc, 'Total amount paid', totalLabel, y, COLORS.buyerBlue);
    y += 14;

    // ── Shipping details (calculated shipping) ────────────────────────────────
    if (listing.shippingOption === 'calculated' && transaction.shippingCarrier) {
      y = drawSectionTitle(doc, 'Shipping Details', y);
      y = drawKeyValue(doc, 'Carrier', transaction.shippingCarrier, y);
      if (transaction.shippingService)      y = drawKeyValue(doc, 'Service', transaction.shippingService, y);
      if (transaction.shippingDeliveryDays) y = drawKeyValue(doc, 'Est. delivery', `${transaction.shippingDeliveryDays} business days`, y);
      if (transaction.buyerDeliveryAddress?.city) {
        const addr = transaction.buyerDeliveryAddress;
        const addrStr = [addr.city, addr.state, addr.postalCode, addr.country].filter(Boolean).join(', ');
        y = drawKeyValue(doc, 'Ship to', addrStr, y);
      }
      y += 10;
    }

    // ── Notes ─────────────────────────────────────────────────────────────────
    doc.save()
      .fillColor(COLORS.muted)
      .fontSize(8)
      .font('Helvetica')
      .text(
        `The platform fee of ${commissionRate} is included within the sale price and is paid to BidRoom by the seller. ` +
        'This receipt is for record-keeping purposes.',
        MARGIN,
        y,
        { width: CONTENT_WIDTH }
      )
      .restore();

    drawFooter(doc);
    doc.end();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function generateInvoicePdf(transaction, role) {
  if (role === 'seller') return buildSellerInvoicePdf(transaction);
  return buildBuyerInvoicePdf(transaction);
}

module.exports = {
  generateInvoicePdf,
  getBidRoomFee,
  getStripeFee,
  getShippingAmount,
  getShippingLabel,
  getSellerPayout,
  getBuyerTotal
};
