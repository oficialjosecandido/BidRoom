const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

/**
 * A plain-text alternative derived from the HTML, for senders that have none.
 *
 * The 41 file templates each author their own `text`, which is always better
 * than anything derived and so always wins. This exists for the senders that
 * build HTML inline — admin campaigns above all, which are bulk mail and the
 * most heavily filtered thing BidRoom sends.
 *
 * Link text alone is useless in plain text ("View in Dashboard" is not a URL),
 * so each anchor keeps its href beside its label.
 */
function htmlToText(html) {
  return String(html || '')
    // Content that is markup, not prose.
    .replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (m, href, label) => {
        const clean = label.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        return clean && !clean.includes(href) ? `${clean} (${href})` : href;
      })
    // Anything that ends a visual line becomes a real one. `</a>` is in here
    // because a button is usually followed immediately by the next block, and
    // without it the link runs into whatever comes next on one line.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|table|a|ul|ol)>/gi, '\n')
    // `<li>` opens its own line, so `</li>` must not add a second one — that is
    // what double-spaced the items.
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    // Cells need a separator or a label/value row reads as "Lance actual€150.00".
    // A tab is what a mail client renders as a column gap, so tabs survive the
    // whitespace collapse below.
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    // Named entities BidRoom's own markup actually uses — € above all, since
    // every price in every email is written as an entity.
    .replace(/&(nbsp|amp|lt|gt|quot|apos|euro|hellip|mdash|ndash|middot|times|copy|reg|deg|laquo|raquo);/gi,
      (m, name) => ({
        nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
        euro: '€', hellip: '…', mdash: '—', ndash: '–', middot: '·',
        times: '×', copy: '©', reg: '®', deg: '°', laquo: '«', raquo: '»'
      }[name.toLowerCase()] || m))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    // Collapse the whitespace the markup left behind, but keep paragraphs apart.
    .split('\n')
    .map(line => line.replace(/[  ]+/g, ' ').replace(/\s*\t\s*/g, '\t').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Create a transporter (you'll need to configure this with your email provider)
const createTransporter = () => {
  // Check if Gmail credentials are provided (works for both development and production)
  if (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD // This should be an App Password, not your regular Gmail password
      }
    });
  }
  
  // Fallback to Ethereal for development (if no Gmail credentials)
  if (process.env.NODE_ENV !== 'production') {
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: {
        user: process.env.ETHEREAL_USER || 'ethereal.user@ethereal.email',
        pass: process.env.ETHEREAL_PASS || 'ethereal.password'
      }
    });
  }
  
  // Production fallback - should not reach here if EMAIL_USER is set
  throw new Error('Email configuration missing. Please set EMAIL_USER and EMAIL_PASSWORD environment variables.');
};

/**
 * Send email with retry logic for rate limiting
 * Optimized for fast delivery (within 5 seconds when possible)
 *
 * `text` is the plain-text alternative. Every template has carried one all along
 * but nothing ever read it, so every BidRoom email went out HTML-only — which
 * spam filters score against, and which leaves nothing at all for a client that
 * does not render HTML. Passing it makes the message multipart/alternative.
 *
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @param {Object} [options]
 * @param {string} [options.text] - Plain-text alternative; omitted if empty
 * @param {number} [options.maxRetries=3] - Maximum number of attempts
 * @param {number} [options.retryDelay=1000] - Base delay between retries in ms
 */
const sendEmail = async (to, subject, html, options = {}) => {
  const { text, maxRetries = 3, retryDelay = 1000 } = options;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const transporter = createTransporter();

      const mailOptions = {
        from: process.env.EMAIL_FROM || 'contact@bidroom.pt',
        to,
        subject,
        html
      };
      // An authored text part always wins; otherwise derive one. Only ever set
      // when non-empty: an empty text part is worse than none, since a client
      // may prefer it and show a blank message.
      const plain = (text && String(text).trim()) || htmlToText(html);
      if (plain) {
        mailOptions.text = plain;
      }

      const info = await transporter.sendMail(mailOptions);
      logger.info('📧 Email sent:', info.messageId);
      
      // In development, log the preview URL
      if (process.env.NODE_ENV !== 'production') {
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
          logger.info('📧 Preview URL:', previewUrl);
        }
      }
      
      return info;
    } catch (error) {
      lastError = error;
      
      // Check if it's a rate limit error
      const isRateLimit = error.responseCode === 403 || 
                         (error.response && error.response.includes('rate limited')) ||
                         (error.message && error.message.includes('rate limited'));
      
      if (isRateLimit && attempt < maxRetries) {
        // Extract wait time from error message - try multiple formats
        let waitTime = retryDelay;
        const errorMessage = (error.response || error.message || '').toLowerCase();
        
        // Try to extract wait time: "check again in 1 seconds" or "rate limited. check again in 1 seconds"
        const patterns = [
          /check again in (\d+)\s*seconds?/i,
          /wait (\d+)\s*seconds?/i,
          /retry after (\d+)\s*seconds?/i,
          /(\d+)\s*seconds?/i  // Last resort: any number followed by "seconds"
        ];
        
        let matchedSeconds = null;
        for (const pattern of patterns) {
          const match = errorMessage.match(pattern);
          if (match) {
            matchedSeconds = parseInt(match[1]);
            // Sanity check: don't wait more than 10 seconds
            if (matchedSeconds > 0 && matchedSeconds <= 10) {
              break;
            }
            matchedSeconds = null; // Invalid value, try next pattern
          }
        }
        
        if (matchedSeconds) {
          // Use extracted time + 0.5 second buffer (max 5 seconds total)
          waitTime = Math.min((matchedSeconds + 0.5) * 1000, 5000);
        } else {
          // Default short delays: 1s, 2s, 3s (to stay under 5 seconds total)
          waitTime = retryDelay * attempt;
        }
        
        logger.warn(`⚠️  Email rate limited. Retrying in ${(waitTime/1000).toFixed(1)}s... (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // For other errors or final attempt, log and throw
      if (attempt === maxRetries) {
        logger.error(`❌ Email sending failed after ${maxRetries} attempts:`, error.message);
        // A 535 is always the same mistake and always worth naming: the account
        // password was used where Gmail requires an App Password. The hint lived
        // in one route, so it only appeared for balance top-ups.
        if (error.message && error.message.includes('535')) {
          logger.warn('   SMTP auth rejected: set EMAIL_USER and EMAIL_PASSWORD (a Gmail App Password, not the account password).');
        }
        // In development, log email details instead of failing completely
        if (process.env.NODE_ENV !== 'production') {
          logger.info('\n📧 EMAIL CONTENT (would have been sent):');
          logger.info('=====================================');
          logger.info(`To: ${to}`);
          logger.info(`Subject: ${subject}`);
          logger.info(`HTML Length: ${html.length} chars`);
          logger.info('=====================================\n');
        }
      }
    }
  }
  
  // If we get here, all retries failed
  throw lastError;
};

module.exports = {
  sendEmail,
  htmlToText
};
