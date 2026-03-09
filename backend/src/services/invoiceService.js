const PDFDocument = require('pdfkit');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUsd(amount) {
  return '$' + Number(amount).toFixed(2);
}

function formatDate(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}

function getAuctionTypeLabel(transaction) {
  const fmt = transaction.listing?.auctionFormat;
  if (fmt === 'best-offer') return 'Best Offer';
  if (transaction.listing?.allowPrivateRoom) return 'Highest-Bid Auction (Private Room)';
  return 'Highest-Bid Auction';
}

function getSalePriceLabel(transaction) {
  const fmt = transaction.listing?.auctionFormat;
  return fmt === 'best-offer' ? 'Accepted offer price' : 'Final auction price';
}

/** Get platform fee (commission) from transaction */
function getPlatformFee(transaction) {
  const rate = transaction.listing?.commissionRate ?? 0.005;
  return transaction.amount * rate;
}

function getCommissionRateLabel(transaction) {
  const rate = transaction.listing?.commissionRate ?? 0.005;
  return (rate * 100).toFixed(1) + '%';
}

/** Get shipping amount: flat-rate uses listing.shippingCost; free/local = 0; calculated = null */
function getShippingAmount(transaction) {
  const opt = transaction.listing?.shippingOption || 'flat-rate';
  if (opt === 'free' || opt === 'local-pickup') return 0;
  if (opt === 'flat-rate') return transaction.listing?.shippingCost ?? 0;
  return null;
}

function getShippingLabel(transaction) {
  const opt = transaction.listing?.shippingOption || 'flat-rate';
  if (opt === 'free') return 'Free';
  if (opt === 'local-pickup') return 'Local pickup (free)';
  const amount = getShippingAmount(transaction);
  return amount !== null ? formatUsd(amount) : 'Calculated separately';
}

/** Get seller payout (amount - platform fee) */
function getSellerPayout(transaction) {
  return transaction.amount - getPlatformFee(transaction);
}

/** Get buyer total (amount + shipping when known) */
function getBuyerTotal(transaction) {
  const shipping = getShippingAmount(transaction);
  return shipping !== null ? transaction.amount + shipping : null;
}

// ─── PDF layout helpers ────────────────────────────────────────────────────────

const COLORS = {
  brand: '#1a1a2e',
  accent: '#e94560',
  text: '#333333',
  muted: '#666666',
  light: '#f5f5f5',
  border: '#e0e0e0',
  white: '#ffffff',
  sellerGreen: '#1b7f4f',
  buyerBlue: '#1a5fa8'
};

const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function drawHorizontalLine(doc, y, color = COLORS.border) {
  doc.save()
    .strokeColor(color)
    .lineWidth(0.5)
    .moveTo(MARGIN, y)
    .lineTo(PAGE_WIDTH - MARGIN, y)
    .stroke()
    .restore();
}

function drawHeader(doc, role) {
  // Brand block
  doc.save()
    .rect(0, 0, PAGE_WIDTH, 80)
    .fill(COLORS.brand)
    .restore();

  doc.save()
    .fillColor(COLORS.white)
    .fontSize(22)
    .font('Helvetica-Bold')
    .text('BidRoom', MARGIN, 22)
    .restore();

  doc.save()
    .fillColor('#aaaacc')
    .fontSize(9)
    .font('Helvetica')
    .text('Auction Marketplace', MARGIN, 48)
    .restore();

  const docLabel = role === 'seller' ? 'SELLER INVOICE' : 'BUYER RECEIPT';
  const labelColor = role === 'seller' ? COLORS.sellerGreen : COLORS.buyerBlue;

  doc.save()
    .rect(PAGE_WIDTH - MARGIN - 130, 18, 130, 44)
    .fill(labelColor)
    .restore();

  doc.save()
    .fillColor(COLORS.white)
    .fontSize(13)
    .font('Helvetica-Bold')
    .text(docLabel, PAGE_WIDTH - MARGIN - 130, 34, { width: 130, align: 'center' })
    .restore();
}

function drawSectionTitle(doc, title, y) {
  doc.save()
    .fillColor(COLORS.muted)
    .fontSize(8)
    .font('Helvetica-Bold')
    .text(title.toUpperCase(), MARGIN, y)
    .restore();
  drawHorizontalLine(doc, y + 12);
  return y + 20;
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

    const platformFee = getPlatformFee(transaction);
    const shipping = getShippingAmount(transaction);
    const sellerPayout = getSellerPayout(transaction);
    const listing = transaction.listing || {};
    const seller = transaction.seller || {};
    const buyer = transaction.buyer || {};

    const transactionDate = formatDate(transaction.paidAt || transaction.updatedAt || transaction.createdAt);
    const auctionType = getAuctionTypeLabel(transaction);
    const commissionRate = getCommissionRateLabel(transaction);
    const salePriceLabel = getSalePriceLabel(transaction);

    // Header
    drawHeader(doc, 'seller');

    let y = 100;

    // ── Transaction meta ──────────────────────────────────────────────────────
    y = drawSectionTitle(doc, 'Transaction Details', y);
    y = drawKeyValue(doc, 'Transaction ID', transaction._id.toString(), y);
    y = drawKeyValue(doc, 'Date', transactionDate, y);
    y = drawKeyValue(doc, 'Auction type', auctionType, y);
    y = drawKeyValue(doc, 'Item', listing.title || 'N/A', y);
    y += 10;

    // ── Parties ───────────────────────────────────────────────────────────────
    y = drawSectionTitle(doc, 'Parties', y);

    const sellerName = [seller.firstName, seller.lastName].filter(Boolean).join(' ') || 'N/A';
    const buyerName = [buyer.firstName, buyer.lastName].filter(Boolean).join(' ') || 'N/A';

    y = drawKeyValue(doc, 'Seller (you)', sellerName, y, { bold: true });
    if (seller.email) y = drawKeyValue(doc, 'Seller email', seller.email, y);
    y = drawKeyValue(doc, 'Buyer', buyerName, y);
    if (buyer.email) y = drawKeyValue(doc, 'Buyer email', buyer.email, y);
    y += 10;

    // ── Payment Breakdown ─────────────────────────────────────────────────────
    y = drawSectionTitle(doc, 'Payment Breakdown', y);

    y = drawBreakdownRow(doc, salePriceLabel, formatUsd(transaction.amount), y);
    y = drawBreakdownRow(doc, `Shipping costs (${listing.shippingOption || 'flat-rate'})`, getShippingLabel(transaction), y);
    y = drawBreakdownRow(doc, 'Taxes / VAT', '$0.00', y);
    y += 4;
    drawHorizontalLine(doc, y);
    y += 8;
    y = drawBreakdownRow(doc, `BidRoom platform fee (${commissionRate} of sale price)`, `- ${formatUsd(platformFee)}`, y, { valueColor: COLORS.accent });
    y += 10;

    y = drawTotalRow(doc, 'Final payout to you (seller)', formatUsd(sellerPayout), y, COLORS.sellerGreen);
    y += 14;

    // ── Notes ─────────────────────────────────────────────────────────────────
    doc.save()
      .fillColor(COLORS.muted)
      .fontSize(8)
      .font('Helvetica')
      .text(
        `Commission rate applied: ${commissionRate}. Platform fee is deducted from the sale price at transaction completion. ` +
        'Shipping costs are collected by the seller separately and are not deducted from the payout shown above.',
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

    const platformFee = getPlatformFee(transaction);
    const shipping = getShippingAmount(transaction);
    const buyerTotal = getBuyerTotal(transaction);
    const listing = transaction.listing || {};
    const seller = transaction.seller || {};
    const buyer = transaction.buyer || {};

    const transactionDate = formatDate(transaction.paidAt || transaction.updatedAt || transaction.createdAt);
    const auctionType = getAuctionTypeLabel(transaction);
    const commissionRate = getCommissionRateLabel(transaction);
    const salePriceLabel = getSalePriceLabel(transaction);

    // Header
    drawHeader(doc, 'buyer');

    let y = 100;

    // ── Transaction meta ──────────────────────────────────────────────────────
    y = drawSectionTitle(doc, 'Transaction Details', y);
    y = drawKeyValue(doc, 'Transaction ID', transaction._id.toString(), y);
    y = drawKeyValue(doc, 'Date', transactionDate, y);
    y = drawKeyValue(doc, 'Auction type', auctionType, y);
    y = drawKeyValue(doc, 'Item', listing.title || 'N/A', y);
    y += 10;

    // ── Parties ───────────────────────────────────────────────────────────────
    y = drawSectionTitle(doc, 'Parties', y);

    const buyerName = [buyer.firstName, buyer.lastName].filter(Boolean).join(' ') || 'N/A';
    const sellerName = [seller.firstName, seller.lastName].filter(Boolean).join(' ') || 'N/A';

    y = drawKeyValue(doc, 'Buyer (you)', buyerName, y, { bold: true });
    if (buyer.email) y = drawKeyValue(doc, 'Buyer email', buyer.email, y);
    y = drawKeyValue(doc, 'Seller', sellerName, y);
    if (seller.email) y = drawKeyValue(doc, 'Seller email', seller.email, y);
    y += 10;

    // ── Payment Breakdown ─────────────────────────────────────────────────────
    y = drawSectionTitle(doc, 'Payment Breakdown', y);

    y = drawBreakdownRow(doc, salePriceLabel, formatUsd(transaction.amount), y);
    y = drawBreakdownRow(doc, `BidRoom platform fee (${commissionRate}, included in price)`, formatUsd(platformFee), y, { valueColor: COLORS.muted });
    y = drawBreakdownRow(doc, `Shipping costs (${listing.shippingOption || 'flat-rate'})`, getShippingLabel(transaction), y);
    y = drawBreakdownRow(doc, 'Taxes / VAT', '$0.00', y);
    y += 4;
    drawHorizontalLine(doc, y);
    y += 12;

    const totalLabel = buyerTotal !== null ? formatUsd(buyerTotal) : `${formatUsd(transaction.amount)} + shipping`;
    y = drawTotalRow(doc, 'Total amount paid', totalLabel, y, COLORS.buyerBlue);
    y += 14;

    // ── Notes ─────────────────────────────────────────────────────────────────
    doc.save()
      .fillColor(COLORS.muted)
      .fontSize(8)
      .font('Helvetica')
      .text(
        `The platform fee of ${commissionRate} is included within the sale price and is paid to BidRoom by the seller. ` +
        'Shipping costs are paid separately to the seller. This receipt is for record-keeping purposes.',
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
  getPlatformFee,
  getShippingAmount,
  getSellerPayout,
  getBuyerTotal
};
