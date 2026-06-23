/**
 * Shared BidRoom-branded HTML layout for transactional emails.
 * Table-based markup for broad email client support.
 * Palette aligned with app UI: dark surfaces (#111), gold accent (#C9A84C), cream text (#F0EDE8).
 */

const BRAND = {
  dark: '#111111',
  darkSoft: '#1a1a1a',
  cream: '#F0EDE8',
  creamMuted: 'rgba(240, 237, 232, 0.65)',
  gold: '#C9A84C',
  goldDark: '#a8872e',
  goldLight: '#faf6eb',
  goldBorder: '#e8d9a8',
  text: '#334155',
  textDark: '#0f172a',
  muted: '#64748b',
  bg: '#ececea',
  line: 'rgba(240, 237, 232, 0.12)'
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
          <a href="${url}" style="display:inline-block;padding:14px 32px;color:#090909;font-weight:700;text-decoration:none;font-size:14px;letter-spacing:0.02em;">${label}</a>
        </td>
      </tr>
    </table>`;
}

function emailInfoBox(html) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:20px 0;">
      <tr>
        <td style="background:${BRAND.goldLight};border:1px solid ${BRAND.goldBorder};border-radius:12px;padding:16px 18px;color:${BRAND.text};font-size:14px;line-height:1.6;">
          ${html}
        </td>
      </tr>
    </table>`;
}

/** Highlight card for confirmations (offer received, bid placed, etc.) */
function emailSuccessBox(heading, detailHtml) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:20px 0;">
      <tr>
        <td style="background:${BRAND.goldLight};border:1px solid ${BRAND.goldBorder};border-left:4px solid ${BRAND.gold};border-radius:12px;padding:18px 20px;">
          <div style="font-size:15px;font-weight:700;color:${BRAND.textDark};margin-bottom:10px;">${heading}</div>
          <div style="font-size:14px;line-height:1.65;color:${BRAND.text};">${detailHtml}</div>
        </td>
      </tr>
    </table>`;
}

/** Prominent amount + listing summary */
function emailAmountCard(amount, listingTitle) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 0;">
      <tr>
        <td align="center" style="padding:16px 12px;background:#ffffff;border:1px solid ${BRAND.goldBorder};border-radius:10px;">
          <div style="font-size:11px;font-weight:600;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Your offer</div>
          <div style="font-size:32px;font-weight:700;color:${BRAND.goldDark};line-height:1.1;margin-bottom:8px;">${amount}</div>
          <div style="font-size:14px;color:${BRAND.text};font-weight:600;">${listingTitle}</div>
        </td>
      </tr>
    </table>`;
}

function emailPayoutBox(amountLabel) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:20px 0;">
      <tr>
        <td align="center" style="background:${BRAND.goldLight};border:1px solid ${BRAND.goldBorder};border-radius:12px;padding:18px;">
          <div style="font-size:11px;font-weight:600;color:${BRAND.goldDark};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Your payout</div>
          <div style="font-size:28px;font-weight:700;color:${BRAND.goldDark};">${amountLabel}</div>
        </td>
      </tr>
    </table>`;
}

function emailStepsList(items) {
  const rows = items
    .map(
      (item) => `
        <tr>
          <td valign="top" style="padding:0 0 10px;width:22px;color:${BRAND.gold};font-size:16px;line-height:1.4;">•</td>
          <td style="padding:0 0 10px;color:${BRAND.text};font-size:14px;line-height:1.55;">${item}</td>
        </tr>`
    )
    .join('');
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:16px 0 0;">
      ${rows}
    </table>`;
}

function emailTextLink(url, label) {
  return `<a href="${url}" style="color:${BRAND.goldDark};font-weight:600;text-decoration:underline;">${label}</a>`;
}

/**
 * @param {{ title: string, bodyHtml: string, preheader?: string, ctaUrl?: string, ctaLabel?: string }} opts
 */
function wrapBidRoomEmail({ title, bodyHtml, preheader, ctaUrl, ctaLabel }) {
  const cta = emailCta(ctaUrl, ctaLabel);
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  ${preheaderHtml}
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${BRAND.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:${BRAND.dark};padding:24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td>
                    <span style="color:${BRAND.gold};font-size:18px;font-weight:700;letter-spacing:-0.02em;">BidRoom</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:${BRAND.gold};height:3px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:32px 32px 8px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:${BRAND.textDark};line-height:1.25;letter-spacing:-0.02em;">${title}</h1>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:8px 32px 36px;color:${BRAND.text};font-size:15px;line-height:1.65;">
              ${bodyHtml}
              ${cta}
              <p style="margin:28px 0 0;color:${BRAND.muted};font-size:14px;line-height:1.5;">Best regards,<br><strong style="color:${BRAND.textDark};">The BidRoom Team</strong></p>
            </td>
          </tr>
          <tr>
            <td style="background:${BRAND.darkSoft};padding:16px 32px;text-align:center;color:${BRAND.creamMuted};font-size:11px;line-height:1.5;">
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
  emailSuccessBox,
  emailAmountCard,
  emailPayoutBox,
  emailStepsList,
  emailTextLink,
  wrapBidRoomEmail
};
