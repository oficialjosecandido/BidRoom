const PDFDocument = require('pdfkit');

/** Format amount as USD */
function formatUsd(amount) {
  return '$' + Number(amount).toFixed(2);
}

/** Get platform fee (commission) from transaction */
function getPlatformFee(transaction) {
  const rate = transaction.listing?.commissionRate ?? 0.005;
  return transaction.amount * rate;
}

/** Get shipping amount: flat-rate uses listing.shippingCost; free/local = 0; calculated = null */
function getShippingAmount(transaction) {
  const opt = transaction.listing?.shippingOption || 'flat-rate';
  if (opt === 'free' || opt === 'local-pickup') return 0;
  if (opt === 'flat-rate') return transaction.listing?.shippingCost ?? 0;
  return null;
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

/** Format date for display */
function formatDate(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Build seller invoice PDF buffer */
async function buildSellerInvoicePdf(transaction) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const platformFee = getPlatformFee(transaction);
    const shipping = getShippingAmount(transaction);
    const sellerPayout = getSellerPayout(transaction);
    const buyerTotal = getBuyerTotal(transaction);
    const listing = transaction.listing || {};
    const seller = transaction.seller || {};
    const buyer = transaction.buyer || {};

    doc.fontSize(20).text('Seller Invoice', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10);

    doc.text(`Transaction ID: ${transaction._id}`);
    doc.text(`Date: ${formatDate(transaction.paidAt || transaction.updatedAt || transaction.createdAt)}`);
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

    doc.text('Payment breakdown:', { underline: true });
    doc.moveDown(0.5);
    doc.text(`Item sale price:                    ${formatUsd(transaction.amount)}`);
    doc.text(`Buyer paid amount:                  ${buyerTotal !== null ? formatUsd(buyerTotal) : 'N/A'}`);
    doc.text(`Platform fees:                      ${formatUsd(platformFee)}`);
    doc.text(`Taxes / VAT:                        $0.00`);
    doc.text(`Shipping costs:                     ${shipping !== null ? (shipping === 0 ? 'Free' : formatUsd(shipping)) : 'N/A'}`);
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Final payout to seller:           ${formatUsd(sellerPayout)}`, { continued: false });
    doc.fontSize(10);

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

    const platformFee = getPlatformFee(transaction);
    const shipping = getShippingAmount(transaction);
    const buyerTotal = getBuyerTotal(transaction);
    const listing = transaction.listing || {};
    const seller = transaction.seller || {};
    const buyer = transaction.buyer || {};

    doc.fontSize(20).text('Purchase Receipt', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10);

    doc.text(`Transaction ID: ${transaction._id}`);
    doc.text(`Date: ${formatDate(transaction.paidAt || transaction.updatedAt || transaction.createdAt)}`);
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

    doc.text('Payment breakdown:', { underline: true });
    doc.moveDown(0.5);
    doc.text(`Item sale price:                    ${formatUsd(transaction.amount)}`);
    doc.text(`Platform fees (included):           ${formatUsd(platformFee)}`);
    doc.text(`Taxes / VAT:                        $0.00`);
    doc.text(`Shipping costs:                     ${shipping !== null ? (shipping === 0 ? 'Free' : formatUsd(shipping)) : 'N/A'}`);
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Total paid:                        ${buyerTotal !== null ? formatUsd(buyerTotal) : formatUsd(transaction.amount) + ' + shipping'}`, { continued: false });
    doc.fontSize(10);

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
  getPlatformFee,
  getShippingAmount,
  getSellerPayout,
  getBuyerTotal
};
