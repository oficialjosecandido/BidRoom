/**
 * One-off: creates every collection + index defined by our Mongoose models
 * in the target database, without copying any documents.
 *
 * Usage:
 *   MONGO_URI="mongodb+srv://user:pass@host/bidroom_prod" node src/scripts/provisionProdSchema.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const modelFiles = [
  'AccountStatusAuditLog', 'Bid', 'Block', 'BlogPost', 'CategoryFollow',
  'Customer', 'DamageClaim', 'Follow', 'FraudEvent', 'Listing',
  'ListingDraft', 'ListingPageView', 'ModerationAuditLog', 'Notification',
  'NotificationPreferences', 'Offer', 'PrivateRoomAuditLog', 'Report',
  'Review', 'ReviewAppeal', 'ReviewFlag', 'SupportConversation',
  'SupportMessage', 'Topup', 'Transaction', 'Watchlist',
];

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI environment variable is not set');

  await mongoose.connect(uri);
  console.log(`Connected to database: ${mongoose.connection.name}`);

  const models = modelFiles.map((name) => require(`../models/${name}`));

  for (const Model of models) {
    await Model.createCollection();
    await Model.syncIndexes();
    console.log(`✓ ${Model.collection.name}`);
  }

  console.log(`Done. ${models.length} collections provisioned (empty) in "${mongoose.connection.name}".`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
