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

/** Build seller invoice PDF buffer */
async function buildSellerInvoicePdf(transaction) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
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

    doc.end();
  });
}

/** Build buyer receipt/invoice PDF buffer */
async function buildBuyerInvoicePdf(transaction) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
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

    doc.end();
  });
}

/**
 * Generate invoice PDF for seller or buyer
 * @param {Object} transaction - Populated transaction (listing, seller, buyer)
 * @param {'seller'|'buyer'} role
 * @returns {Promise<Buffer>}
 */
async function generateInvoicePdf(transaction, role) {
  if (role === 'seller') {
    return buildSellerInvoicePdf(transaction);
  }
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
