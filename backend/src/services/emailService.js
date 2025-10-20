const nodemailer = require('nodemailer');

// Create a transporter (you'll need to configure this with your email provider)
const createTransporter = () => {
  // For development, you can use a test account or your own SMTP settings
  // For production, use domain-specific SMTP settings
  
  if (process.env.NODE_ENV === 'production') {
    return nodemailer.createTransporter({
      service: 'gmail', // or your email provider
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
  } else {
    // For development, you can use a test account
    return nodemailer.createTransporter({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: {
        user: process.env.ETHEREAL_USER || 'ethereal.user@ethereal.email',
        pass: process.env.ETHEREAL_PASS || 'ethereal.password'
      }
    });
  }
};

const sendEmail = async (to, subject, html) => {
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
      console.log('📧 Preview URL:', nodemailer.getTestMessageUrl(info));
    }
    
    return info;
  } catch (error) {
    console.error('❌ Email sending failed:', error);
    throw error;
  }
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

module.exports = {
  sendEmail,
  sendEmailVerification,
  sendPasswordReset
};
