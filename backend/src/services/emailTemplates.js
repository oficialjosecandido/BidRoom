/**
 * Email Templates Service (Deprecated - Use templateEngine.js instead)
 * This file is kept for backward compatibility but will be removed
 * Use: const { renderEmailTemplate } = require('./templateEngine');
 */

const { renderEmailTemplate, DEFAULT_LANGUAGE } = require('./templateEngine');
const logger = require('../utils/logger');

// Legacy templates object - will be removed
const templates = {
  // Auction Closed - For bidders (except winner and seller)
  auctionClosed: {
    en: (data) => ({
      subject: `Auction Closed: ${data.listingTitle}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #8b5a96 0%, #a67db5 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #8b5a96; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Auction Closed</h1>
            </div>
            <div class="content">
              <p>Hello ${data.bidderName},</p>
              <p>The auction for <strong>${data.listingTitle}</strong> has closed.</p>
              <p>Final bid: <strong>${data.finalBid}</strong></p>
              <p>The seller will select a winner within 24 hours. You will be notified if you are selected as the winner.</p>
              <a href="${data.listingUrl}" class="button">View Listing</a>
              <p>Thank you for participating!</p>
              <p>Best regards,<br>The BidRoom Team</p>
            </div>
            <div class="footer">
              <p>This is an automated message. Please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `
    }),
    pt: (data) => ({
      subject: `Leilão Encerrado: ${data.listingTitle}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #8b5a96 0%, #a67db5 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #8b5a96; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Leilão Encerrado</h1>
            </div>
            <div class="content">
              <p>Olá ${data.bidderName},</p>
              <p>O leilão para <strong>${data.listingTitle}</strong> foi encerrado.</p>
              <p>Lance final: <strong>${data.finalBid}</strong></p>
              <p>O vendedor selecionará um vencedor em até 24 horas. Você será notificado se for selecionado como vencedor.</p>
              <a href="${data.listingUrl}" class="button">Ver Anúncio</a>
              <p>Obrigado por participar!</p>
              <p>Atenciosamente,<br>Equipe BidRoom</p>
            </div>
            <div class="footer">
              <p>Esta é uma mensagem automática. Por favor, não responda.</p>
            </div>
          </div>
        </body>
        </html>
      `
    })
  },

  // Choose Winner - For seller
  chooseWinner: {
    en: (data) => ({
      subject: `Action Required: Choose Winner for ${data.listingTitle}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ff6b6b 0%, #ff8e8e 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #ff6b6b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .urgent { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Action Required</h1>
            </div>
            <div class="content">
              <p>Hello ${data.sellerName},</p>
              <p>The auction for <strong>${data.listingTitle}</strong> has closed.</p>
              <p>Final bid: <strong>${data.finalBid}</strong></p>
              <div class="urgent">
                <p><strong>⚠️ Important:</strong> You have <strong>24 hours</strong> to select a winner for this auction.</p>
              </div>
              <p>Please review the bids and select the winner:</p>
              <a href="${data.chooseWinnerUrl}" class="button">Choose Winner</a>
              <p>If you don't select a winner within 24 hours, the highest bidder will be automatically selected.</p>
              <p>Best regards,<br>The BidRoom Team</p>
            </div>
            <div class="footer">
              <p>This is an automated message. Please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `
    }),
    pt: (data) => ({
      subject: `Ação Necessária: Escolha o Vencedor para ${data.listingTitle}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ff6b6b 0%, #ff8e8e 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #ff6b6b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .urgent { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Ação Necessária</h1>
            </div>
            <div class="content">
              <p>Olá ${data.sellerName},</p>
              <p>O leilão para <strong>${data.listingTitle}</strong> foi encerrado.</p>
              <p>Lance final: <strong>${data.finalBid}</strong></p>
              <div class="urgent">
                <p><strong>⚠️ Importante:</strong> Você tem <strong>24 horas</strong> para selecionar um vencedor para este leilão.</p>
              </div>
              <p>Por favor, revise os lances e selecione o vencedor:</p>
              <a href="${data.chooseWinnerUrl}" class="button">Escolher Vencedor</a>
              <p>Se você não selecionar um vencedor em 24 horas, o maior lance será automaticamente selecionado.</p>
              <p>Atenciosamente,<br>Equipe BidRoom</p>
            </div>
            <div class="footer">
              <p>Esta é uma mensagem automática. Por favor, não responda.</p>
            </div>
          </div>
        </body>
        </html>
      `
    })
  },

  // You Won - For winner
  youWon: {
    en: (data) => ({
      subject: `🎉 Congratulations! You Won: ${data.listingTitle}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #22c55e 0%, #4ade80 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .success-box { background: #d1fae5; border-left: 4px solid #22c55e; padding: 15px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Congratulations!</h1>
            </div>
            <div class="content">
              <p>Hello ${data.winnerName},</p>
              <div class="success-box">
                <p><strong>You won the auction!</strong></p>
                <p><strong>${data.listingTitle}</strong></p>
                <p>Winning bid: <strong>${data.winningBid}</strong></p>
              </div>
              <p>Please complete your payment within 48 hours to secure your purchase.</p>
              <a href="${data.paymentUrl}" class="button">Complete Payment</a>
              <p>If you have any questions, please contact the seller or our support team.</p>
              <p>Congratulations again!</p>
              <p>Best regards,<br>The BidRoom Team</p>
            </div>
            <div class="footer">
              <p>This is an automated message. Please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `
    }),
    pt: (data) => ({
      subject: `🎉 Parabéns! Você Ganhou: ${data.listingTitle}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #22c55e 0%, #4ade80 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            .success-box { background: #d1fae5; border-left: 4px solid #22c55e; padding: 15px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Parabéns!</h1>
            </div>
            <div class="content">
              <p>Olá ${data.winnerName},</p>
              <div class="success-box">
                <p><strong>Você ganhou o leilão!</strong></p>
                <p><strong>${data.listingTitle}</strong></p>
                <p>Lance vencedor: <strong>${data.winningBid}</strong></p>
              </div>
              <p>Por favor, complete seu pagamento em até 48 horas para garantir sua compra.</p>
              <a href="${data.paymentUrl}" class="button">Completar Pagamento</a>
              <p>Se você tiver alguma dúvida, entre em contato com o vendedor ou nossa equipe de suporte.</p>
              <p>Parabéns novamente!</p>
              <p>Atenciosamente,<br>Equipe BidRoom</p>
            </div>
            <div class="footer">
              <p>Esta é uma mensagem automática. Por favor, não responda.</p>
            </div>
          </div>
        </body>
        </html>
      `
    })
  }
};

/**
 * Get email template for a specific type and language
 * @param {string} templateType - Type of template (auctionClosed, chooseWinner, youWon)
 * @param {string} language - Language code (en, pt, es, fr, de)
 * @param {object} data - Data to populate the template
 * @returns {object} Email object with subject, html, and text
 */
function getEmailTemplate(templateType, language = DEFAULT_LANGUAGE, data = {}) {
  // Use new file-based template engine
  try {
    return renderEmailTemplate(templateType, language, data);
  } catch (error) {
    logger.error(`Error loading template "${templateType}" for language "${language}":`, error.message);
    // Fallback to default language
    if (language !== DEFAULT_LANGUAGE) {
      try {
        return renderEmailTemplate(templateType, DEFAULT_LANGUAGE, data);
      } catch (fallbackError) {
        throw new Error(`Template "${templateType}" not found in any language`);
      }
    }
    throw error;
  }
}

/**
 * Get user's preferred language (can be extended to read from user profile)
 * @param {object} user - User object
 * @returns {string} Language code
 */
function getUserLanguage(user) {
  // Default to English, can be extended to read from user profile
  // User language preference can be stored in user.language or user.preferences.language
  return user?.language || user?.preferences?.language || DEFAULT_LANGUAGE;
}

module.exports = {
  getEmailTemplate,
  getUserLanguage,
  templates // Kept for backward compatibility, but deprecated
};

