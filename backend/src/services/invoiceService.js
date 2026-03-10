const PDFDocument = require('pdfkit');

const BIDROOMFEE_RATE = 0.02; // 2%

/** Format amount as USD */
function formatUsd(amount) {
  return '$' + Number(amount).toFixed(2);
}

/** BidRoom platform fee: stored on transaction when paid via Stripe, fallback to rate calculation */
function getBidRoomFee(transaction) {
  if (transaction.bidRoomFeeAmount != null) return transaction.bidRoomFeeAmount;
  const rate = transaction.listing?.commissionRate ?? BIDROOMFEE_RATE;
  return transaction.amount * rate;
}

/** Stripe processing fee: stored after payment capture; null if not yet available */
function getStripeFee(transaction) {
  return transaction.stripeFeeAmount ?? null;
}

/** Shipping amount: flat-rate uses listing.shippingCost; free/local = 0; calculated = null */
function getShippingAmount(transaction) {
  const opt = transaction.listing?.shippingOption || 'flat-rate';
  if (opt === 'free' || opt === 'local-pickup') return 0;
  if (opt === 'flat-rate') return transaction.listing?.shippingCost ?? 0;
  return null;
}

/** Seller payout: stored on transaction when paid; fallback to calculated */
function getSellerPayout(transaction) {
  if (transaction.sellerPayoutAmount != null) return transaction.sellerPayoutAmount;
  const fee = getBidRoomFee(transaction);
  const stripeFee = getStripeFee(transaction) ?? 0;
  return transaction.amount - fee - stripeFee;
}

/** Buyer total charged (including BidRoom fee and shipping) */
function getBuyerTotal(transaction) {
  if (transaction.buyerTotalPaid != null) return transaction.buyerTotalPaid;
  const bidRoomFee = getBidRoomFee(transaction);
  const shipping = getShippingAmount(transaction);
  return shipping !== null ? transaction.amount + bidRoomFee + shipping : null;
}

/** Format date for display */
function formatDate(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Draw a horizontal rule */
function drawRule(doc, y) {
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#cccccc').stroke();
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

    const bidRoomFee = getBidRoomFee(transaction);
    const stripeFee = getStripeFee(transaction);
    const shipping = getShippingAmount(transaction);
    const sellerPayout = getSellerPayout(transaction);
    const listing = transaction.listing || {};
    const seller = transaction.seller || {};
    const buyer = transaction.buyer || {};

    doc.fontSize(20).fillColor('#7A4F84').text('Seller Invoice', { align: 'center' });
    doc.fillColor('#000000').moveDown();
    doc.fontSize(10);

    doc.text(`Transaction ID: ${transaction._id}`);
    doc.text(`Date: ${formatDate(transaction.paidAt || transaction.updatedAt || transaction.createdAt)}`);
    if (transaction.stripePaymentIntentId) {
      doc.text(`Payment reference: ${transaction.stripePaymentIntentId}`);
    }
    doc.moveDown();

    doc.text('Seller:', { continued: false });
    doc.text(`  ${[seller.firstName, seller.lastName].filter(Boolean).join(' ') || 'N/A'}`);
    if (seller.email) doc.text(`  ${seller.email}`);
    doc.moveDown();

    doc.text('Buyer:', { continued: false });
    doc.text(`  ${[buyer.firstName, buyer.lastName].filter(Boolean).join(' ') || 'N/A'}`);
    if (buyer.email) doc.text(`  ${buyer.email}`);
    doc.moveDown();

    doc.text(`Item: ${listing.title || 'N/A'}`);
    doc.moveDown(1.5);

    doc.fontSize(11).text('Payment breakdown', { underline: true });
    doc.fontSize(10).moveDown(0.5);

    doc.text(`Item sale price:                         ${formatUsd(transaction.amount)}`);

    doc.moveDown(0.3);
    drawRule(doc, doc.y);
    doc.moveDown(0.3);

    doc.text(`BidRoom platform fee (2%):               – ${formatUsd(bidRoomFee)}`);

    if (stripeFee !== null) {
      doc.text(`Stripe processing fee (~2.9% + $0.30):  – ${formatUsd(stripeFee)}`);
    } else {
      doc.text(`Stripe processing fee:                  – (deducted by Stripe, see your Stripe dashboard)`);
    }

    if (shipping !== null && shipping > 0) {
      doc.text(`Shipping:                                + ${formatUsd(shipping)}`);
    } else if (shipping === 0) {
      doc.text(`Shipping:                                Free`);
    } else {
      doc.text(`Shipping:                                N/A`);
    }

    doc.moveDown(0.3);
    drawRule(doc, doc.y);
    doc.moveDown(0.5);

    doc.fontSize(12).fillColor('#7A4F84').text(`Your payout:                             ${formatUsd(sellerPayout)}`);
    doc.fillColor('#000000').fontSize(9);
    doc.moveDown(0.3);
    doc.text('Note: The Stripe fee shown is approximate. Your exact payout may vary slightly based on Stripe\'s processing.');

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

    const bidRoomFee = getBidRoomFee(transaction);
    const shipping = getShippingAmount(transaction);
    const buyerTotal = getBuyerTotal(transaction);
    const listing = transaction.listing || {};
    const seller = transaction.seller || {};
    const buyer = transaction.buyer || {};

    doc.fontSize(20).fillColor('#7A4F84').text('Purchase Receipt', { align: 'center' });
    doc.fillColor('#000000').moveDown();
    doc.fontSize(10);

    doc.text(`Transaction ID: ${transaction._id}`);
    doc.text(`Date: ${formatDate(transaction.paidAt || transaction.updatedAt || transaction.createdAt)}`);
    if (transaction.stripePaymentIntentId) {
      doc.text(`Payment reference: ${transaction.stripePaymentIntentId}`);
    }
    doc.moveDown();

    doc.text('Buyer:', { continued: false });
    doc.text(`  ${[buyer.firstName, buyer.lastName].filter(Boolean).join(' ') || 'N/A'}`);
    if (buyer.email) doc.text(`  ${buyer.email}`);
    doc.moveDown();

    doc.text('Seller:', { continued: false });
    doc.text(`  ${[seller.firstName, seller.lastName].filter(Boolean).join(' ') || 'N/A'}`);
    if (seller.email) doc.text(`  ${seller.email}`);
    doc.moveDown();

    doc.text(`Item: ${listing.title || 'N/A'}`);
    doc.moveDown(1.5);

    doc.fontSize(11).text('Payment breakdown', { underline: true });
    doc.fontSize(10).moveDown(0.5);

    doc.text(`Item price:                              ${formatUsd(transaction.amount)}`);
    doc.text(`BidRoom platform fee (2%):               ${formatUsd(bidRoomFee)}`);

    if (shipping !== null) {
      doc.text(`Shipping:                                ${shipping === 0 ? 'Free' : formatUsd(shipping)}`);
    } else {
      doc.text(`Shipping:                                N/A`);
    }

    doc.moveDown(0.3);
    drawRule(doc, doc.y);
    doc.moveDown(0.5);

    doc.fontSize(12).fillColor('#7A4F84').text(
      `Total charged:                           ${buyerTotal !== null ? formatUsd(buyerTotal) : formatUsd(transaction.amount + bidRoomFee) + ' + shipping'}`
    );
    doc.fillColor('#000000').fontSize(9);
    doc.moveDown(0.3);
    doc.text('The BidRoom platform fee (2%) is included in the total charged and covers marketplace services.');

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
  getBidRoomFee,
  getStripeFee,
  getShippingAmount,
  getSellerPayout,
  getBuyerTotal
};
