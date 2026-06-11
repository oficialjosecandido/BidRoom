/**
 * Shared BidRoom-branded HTML layout for transactional emails.
 * Uses table-based markup for broad email client support.
 */

const BRAND = {
  navy: '#1a1a2e',
  gold: '#C9A84C',
  goldLight: '#faf6eb',
  goldBorder: '#e8d9a8',
  green: '#2d7d52',
  greenLight: '#edf7f1',
  greenBorder: '#b8dfc8',
  text: '#334155',
  muted: '#64748b',
  bg: '#f4f4f5'
};

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL || 'https://www.bidroom.pt').replace(/\/$/, '');
}

function transactionUrl(transactionId) {
  const base = frontendBaseUrl();
  return transactionId
    ? `${base}/dashboard/transactions#transaction-${transactionId}`
    : `${base}/dashboard/transactions`;
}

function emailCta(url, label) {
  if (!url || !label) return '';
  return `
    <table cellpadding="0" cellspacing="0" role="presentation" style="margin:28px auto 4px;">
      <tr>
        <td align="center" style="background:${BRAND.gold};border-radius:100px;">
          <a href="${url}" style="display:inline-block;padding:14px 32px;color:#0a0a0a;font-weight:700;text-decoration:none;font-size:14px;letter-spacing:0.02em;">${label}</a>
        </td>
      </tr>
    </table>`;
}

function emailInfoBox(html) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:20px 0;">
      <tr>
        <td style="background:${BRAND.goldLight};border:1px solid ${BRAND.goldBorder};border-radius:10px;padding:14px 16px;color:${BRAND.text};font-size:14px;line-height:1.55;">
          ${html}
        </td>
      </tr>
    </table>`;
}

function emailPayoutBox(amountLabel) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:20px 0;">
      <tr>
        <td align="center" style="background:${BRAND.greenLight};border:1px solid ${BRAND.greenBorder};border-radius:10px;padding:16px;">
          <div style="font-size:11px;font-weight:600;color:${BRAND.green};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Your payout</div>
          <div style="font-size:28px;font-weight:700;color:${BRAND.green};font-family:Georgia,serif;">${amountLabel}</div>
        </td>
      </tr>
    </table>`;
}

function emailTextLink(url, label) {
  return `<a href="${url}" style="color:${BRAND.gold};font-weight:600;text-decoration:underline;">${label}</a>`;
}

/**
 * @param {{ title: string, bodyHtml: string, ctaUrl?: string, ctaLabel?: string }} opts
 */
function wrapBidRoomEmail({ title, bodyHtml, ctaUrl, ctaLabel }) {
  const cta = emailCta(ctaUrl, ctaLabel);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${BRAND.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;">
          <tr>
            <td style="background:${BRAND.navy};padding:22px 28px;border-radius:12px 12px 0 0;">
              <span style="color:${BRAND.gold};font-size:20px;font-weight:700;letter-spacing:0.08em;">BIDROOM</span>
            </td>
          </tr>
          <tr>
            <td style="background:${BRAND.gold};height:4px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:28px 28px 8px;">
              <h1 style="margin:0;font-size:22px;font-weight:700;color:${BRAND.navy};line-height:1.3;">${title}</h1>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:8px 28px 32px;color:${BRAND.text};font-size:15px;line-height:1.65;">
              ${bodyHtml}
              ${cta}
              <p style="margin:28px 0 0;color:${BRAND.muted};font-size:14px;">Best regards,<br><strong style="color:${BRAND.navy};">The BidRoom Team</strong></p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 8px;text-align:center;color:#94a3b8;font-size:11px;line-height:1.5;">
              Automated message · Please do not reply directly to this email
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = {
  BRAND,
  frontendBaseUrl,
  transactionUrl,
  emailCta,
  emailInfoBox,
  emailPayoutBox,
  emailTextLink,
  wrapBidRoomEmail
};
