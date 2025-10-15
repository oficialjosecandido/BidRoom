// MongoDB initialization script for Docker
// This script runs when the MongoDB container is first created

db = db.getSiblingDB('bidroom');

// Create collections with validation
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['azureAdB2CId', 'email', 'firstName', 'lastName'],
      properties: {
        azureAdB2CId: {
          bsonType: 'string',
          description: 'Azure AD B2C user ID - required'
        },
        email: {
          bsonType: 'string',
          description: 'User email - required'
        },
        reputationScore: {
          bsonType: 'number',
          minimum: 0,
          maximum: 5.0,
          description: 'User reputation score between 0 and 5'
        }
      }
    }
  }
});

db.createCollection('auctions');
db.createCollection('bids');
db.createCollection('watchlists');
db.createCollection('transactions');
db.createCollection('disputes');
db.createCollection('ratings');

print('✅ Bidroom database initialized successfully');

