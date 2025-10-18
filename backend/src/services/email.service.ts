import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';
import config from '../config';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class EmailService {
  private transporter!: nodemailer.Transporter;
  private isDevelopment: boolean;

  constructor() {
    this.isDevelopment = config.env === 'development';
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    // Configure SMTP transporter
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
      },
      tls: {
        rejectUnauthorized: false // Allow self-signed certificates in development
      }
    });

    // Verify connection configuration
    this.transporter.verify((error, _success) => {
      if (error) {
        logger.error('SMTP configuration error:', error);
        if (this.isDevelopment) {
          logger.warn('Email service will log emails to console in development mode');
        }
      } else {
        logger.info('✅ SMTP server ready to send emails');
      }
    });
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      if (this.isDevelopment && !process.env.SMTP_USER) {
        // In development without SMTP config, just log the email content
        this.logEmailForDevelopment(options);
        return true;
      }

      // Send real email using Nodemailer
      const mailOptions = {
        from: `"Bidroom" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`✅ Email sent successfully to ${options.to}`, { messageId: info.messageId });
      return true;

    } catch (error) {
      logger.error('Failed to send email:', error);
      
      // Fallback to development mode if SMTP fails
      if (this.isDevelopment) {
        logger.warn('Falling back to development mode - logging email to console');
        this.logEmailForDevelopment(options);
        return true;
      }
      
      return false;
    }
  }

  async sendConfirmationEmail(email: string, confirmationToken: string): Promise<boolean> {
    const confirmationUrl = `${config.frontendUrl}/auth/confirm-email?token=${confirmationToken}&email=${encodeURIComponent(email)}`;
    
    const emailOptions: EmailOptions = {
      to: email,
      subject: 'Confirm your Bidroom account',
      html: this.getConfirmationEmailHtml(confirmationUrl),
      text: this.getConfirmationEmailText(confirmationUrl)
    };

    return this.sendEmail(emailOptions);
  }

  private logEmailForDevelopment(options: EmailOptions): void {
    logger.info('📧 EMAIL WOULD BE SENT:');
    logger.info(`To: ${options.to}`);
    logger.info(`Subject: ${options.subject}`);
    logger.info(`HTML Content: ${options.html}`);
    if (options.text) {
      logger.info(`Text Content: ${options.text}`);
    }
    logger.info('📧 END EMAIL');
  }

  private getConfirmationEmailHtml(confirmationUrl: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Confirm your Bidroom account</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #007bff; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .button { display: inline-block; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎯 Bidroom</h1>
            <h2>Confirm your account</h2>
          </div>
          <div class="content">
            <p>Welcome to Bidroom! To complete your registration and start bidding on amazing items, please confirm your email address.</p>
            <p>Click the button below to confirm your account:</p>
            <a href="${confirmationUrl}" class="button">Confirm Account</a>
            <p>If the button doesn't work, copy and paste this link into your browser:</p>
            <p><a href="${confirmationUrl}">${confirmationUrl}</a></p>
            <p>This link will expire in 24 hours for security reasons.</p>
          </div>
          <div class="footer">
            <p>If you didn't create an account with Bidroom, please ignore this email.</p>
            <p>© 2024 Bidroom. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getConfirmationEmailText(confirmationUrl: string): string {
    return `
Confirm your Bidroom account

Welcome to Bidroom! To complete your registration and start bidding on amazing items, please confirm your email address.

Click this link to confirm your account:
${confirmationUrl}

This link will expire in 24 hours for security reasons.

If you didn't create an account with Bidroom, please ignore this email.

© 2024 Bidroom. All rights reserved.
    `;
  }
}

export const emailService = new EmailService();
