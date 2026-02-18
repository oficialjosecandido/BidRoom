const nodemailer = require('nodemailer');

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
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} retryDelay - Base delay between retries in ms (default: 1000)
 */
const sendEmail = async (to, subject, html, maxRetries = 3, retryDelay = 1000) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const transporter = createTransporter();
      
      const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@bidroom.com',
        to,
        subject,
        html
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('📧 Email sent:', info.messageId);
      
      // In development, log the preview URL
      if (process.env.NODE_ENV !== 'production') {
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
          console.log('📧 Preview URL:', previewUrl);
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
        
        console.warn(`⚠️  Email rate limited. Retrying in ${(waitTime/1000).toFixed(1)}s... (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // For other errors or final attempt, log and throw
      if (attempt === maxRetries) {
        console.error(`❌ Email sending failed after ${maxRetries} attempts:`, error.message);
        // In development, log email details instead of failing completely
        if (process.env.NODE_ENV !== 'production') {
          console.log('\n📧 EMAIL CONTENT (would have been sent):');
          console.log('=====================================');
          console.log(`To: ${to}`);
          console.log(`Subject: ${subject}`);
          console.log(`HTML Length: ${html.length} chars`);
          console.log('=====================================\n');
        }
      }
    }
  }
  
  // If we get here, all retries failed
  throw lastError;
};

const sendEmailVerification = async (email, firstName, verificationToken) => {
  const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:4200'}/auth/verify-email?token=${verificationToken}`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Welcome to BidRoom!</h2>
      <p>Hi ${firstName},</p>
      <p>Thank you for registering with BidRoom. Please click the link below to verify your email address:</p>
      <a href="${verificationUrl}" style="display: inline-block; background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Verify Email Address</a>
      <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
      <p>This link will expire in 24 hours.</p>
      <p>Best regards,<br>The BidRoom Team</p>
    </div>
  `;

  // For development, print the verification link to console
  console.log('\n🔗 EMAIL VERIFICATION LINK:');
  console.log('=====================================');
  console.log(`Email: ${email}`);
  console.log(`Verification URL: ${verificationUrl}`);
  console.log('=====================================\n');

  // Still try to send email, but don't fail if it doesn't work
  try {
    return await sendEmail(email, 'Verify your BidRoom account', html);
  } catch (error) {
    console.log('📧 Email sending failed, but verification link is available above');
    return { messageId: 'console-only' };
  }
};

const sendPasswordReset = async (email, firstName, resetToken) => {
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:4200'}/auth/reset-password?token=${resetToken}`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Password Reset Request</h2>
      <p>Hi ${firstName},</p>
      <p>We received a request to reset your password. Click the link below to reset it:</p>
      <a href="${resetUrl}" style="display: inline-block; background-color: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Reset Password</a>
      <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #666;">${resetUrl}</p>
      <p>This link will expire in 1 hour.</p>
      <p>If you didn't request this password reset, please ignore this email.</p>
      <p>Best regards,<br>The BidRoom Team</p>
    </div>
  `;

  // For development, print the password reset link to console
  console.log('\n🔐 PASSWORD RESET LINK:');
  console.log('=====================================');
  console.log(`Email: ${email}`);
  console.log(`Reset URL: ${resetUrl}`);
  console.log('=====================================\n');

  // Still try to send email, but don't fail if it doesn't work
  try {
    return await sendEmail(email, 'Reset your BidRoom password', html);
  } catch (error) {
    console.log('📧 Email sending failed, but password reset link is available above');
    return { messageId: 'console-only' };
  }
};

/**
 * Notify the seller that the buyer has uploaded proof of payment for a transaction.
 */
const sendSellerProofOfPaymentNotification = async (sellerEmail, sellerFirstName, listingTitle, buyerName, proofUrl) => {
  const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:4200'}/dashboard/transactions`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Proof of payment received</h2>
      <p>Hi ${sellerFirstName || 'Seller'},</p>
      <p>The buyer${buyerName ? ` (${buyerName})` : ''} has marked the transaction as paid and uploaded proof of payment for <strong>${listingTitle || 'your item'}</strong>.</p>
      <p>You can view the proof of payment in your dashboard:</p>
      <a href="${dashboardUrl}" style="display: inline-block; background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">View in Dashboard</a>
      <p>Or open the proof document directly: <a href="${proofUrl}" target="_blank" rel="noopener">View proof of payment</a></p>
      <p>Best regards,<br>The BidRoom Team</p>
    </div>
  `;
  return sendEmail(sellerEmail, 'Proof of payment uploaded – ' + (listingTitle || 'Transaction'), html);
};

/**
 * Notify the seller that the buyer has opened a dispute for a transaction.
 */
const sendSellerDisputeOpenedNotification = async (sellerEmail, sellerFirstName, listingTitle, buyerName, transactionId) => {
  const dashboardUrl = `${process.env.FRONTEND_URL || 'http://localhost:4200'}/dashboard/transactions`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #dc3545;">A dispute has been opened</h2>
      <p>Hi ${sellerFirstName || 'Seller'},</p>
      <p>The buyer${buyerName ? ` (${buyerName})` : ''} has opened a dispute for <strong>${listingTitle || 'your item'}</strong>.</p>
      <p>You can view the buyer's evidence and upload your counter-evidence in your dashboard:</p>
      <a href="${dashboardUrl}" style="display: inline-block; background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">View in Dashboard</a>
      <p>Please respond promptly with your counter-evidence (e.g., original listing photos, proof of secure packaging).</p>
      <p>Best regards,<br>The BidRoom Team</p>
    </div>
  `;
  return sendEmail(sellerEmail, 'Dispute opened – ' + (listingTitle || 'Transaction'), html);
};

module.exports = {
  sendEmail,
  sendEmailVerification,
  sendPasswordReset,
  sendSellerProofOfPaymentNotification,
  sendSellerDisputeOpenedNotification
};
