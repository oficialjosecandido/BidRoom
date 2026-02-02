require('dotenv').config();
const connectDB = require('../config/database');
const Listing = require('../models/Listing');
const User = require('../models/User');

const seedSeaGullWatch = async () => {
  try {
    // Connect to database
    await connectDB();

    // Find or create a test seller user
    let seller = await User.findOne({ email: 'seller@bidroom.com' });
    
    if (!seller) {
      // Create a test seller if it doesn't exist
      seller = new User({
        email: 'seller@bidroom.com',
        firstName: 'Test',
        lastName: 'Seller',
        isActive: true,
        uid: 'test-seller-uid-123' // Test UID for seeding
      });
      await seller.save();
      console.log('✅ Created test seller user');
    }

    // Check if the Sea-Gull watch listing already exists
    const existingListing = await Listing.findOne({ 
      title: { $regex: /Sea-Gull ST1908/i } 
    });

    if (existingListing) {
      console.log('ℹ️  Sea-Gull ST1908 listing already exists');
      console.log(`   Listing ID: ${existingListing._id}`);
      process.exit(0);
    }

    // Calculate end date from duration slot (7 days)
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);

    const listing = new Listing({
      title: 'Sea-Gull ST1908 Manual Wind Chronograph Watch',
      description: `Exceptional Sea-Gull ST1908 Manual Wind Chronograph Watch - A true collector's piece!

This remarkable timepiece features the legendary Sea-Gull ST1908 movement, renowned for its precision and craftsmanship. The ST1908 is a column-wheel chronograph movement, similar in design to the famous Venus 175, making it highly sought after by watch enthusiasts worldwide.

SPECIFICATIONS:
- Movement: Sea-Gull ST1908 manual wind chronograph
- Case Material: Stainless steel
- Case Diameter: 42mm
- Dial: Classic chronograph layout with sub-dials
- Functions: Hours, minutes, small seconds, chronograph with 30-minute counter
- Condition: Pre-owned, excellent condition
- Year: 2010s production
- Includes original box and papers (if available)

This watch represents exceptional value and is perfect for collectors who appreciate mechanical chronographs at an accessible price point. The ST1908 movement is known for its reliability and classic design.

Bidding starts at a fraction of what comparable chronographs cost, making this an incredible opportunity to own a piece of horological history.`,
      category: 'Watches',
      images: [
        'https://via.placeholder.com/600x400?text=Sea-Gull+ST1908+Front',
        'https://via.placeholder.com/600x400?text=Sea-Gull+ST1908+Back',
        'https://via.placeholder.com/600x400?text=Sea-Gull+ST1908+Movement'
      ],
      startingPrice: 350.00,
      currentPrice: 350.00,
      reservePrice: 500.00,
      buyNowPrice: 800.00, // Add Buy Now option
      bidIncrement: 10.00,
      bidCount: 0,
      startDate: new Date(),
      endDate: endDate,
      seller: seller._id,
      status: 'active',
      auctionFormat: 'highest-bid', // Highest Bid Wins format
      durationSlot: '7 days', // Fixed duration slot
      allowPrivateRoom: true, // Allow Private Room (2.0% commission)
      commissionRate: 0.02, // 2.0% commission with Private Room
      isFeatured: true, // Make it featured to test promotion feature
      isVerified: true, // Make it verified to test verification feature
      verificationDetails: 'Authenticated by BidRoom watch experts. Verified serial number and movement authenticity confirmed.',
      listingType: 'Promoted', // Will be set automatically, but explicit for clarity
      condition: 'Used - Excellent',
      location: 'San Francisco, CA',
      shippingCost: 15.00
    });

    await listing.save();
    
    console.log('✅ Successfully created Sea-Gull ST1908 watch listing!');
    console.log(`   Listing ID: ${listing._id}`);
    console.log(`   Slug: ${listing.slug}`);
    console.log(`   URL: /listing/${listing.slug}`);
    console.log(`   Title: ${listing.title}`);
    console.log(`   Starting Price: $${listing.startingPrice}`);
    console.log(`   End Date: ${listing.endDate.toLocaleString()}`);
    console.log(`   Status: ${listing.status}`);
    console.log(`   Featured: ${listing.isFeatured}`);
    console.log(`   Verified: ${listing.isVerified}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding listing:', error);
    process.exit(1);
  }
};

// Run the seed function
seedSeaGullWatch();

