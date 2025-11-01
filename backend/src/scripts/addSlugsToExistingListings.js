require('dotenv').config();
const connectDB = require('../config/database');
const Listing = require('../models/Listing');

// Helper function to generate slug from title
function generateSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

const addSlugsToExistingListings = async () => {
  try {
    // Connect to database
    await connectDB();

    // Find all listings without slugs
    const listingsWithoutSlugs = await Listing.find({ 
      $or: [
        { slug: { $exists: false } },
        { slug: null },
        { slug: '' }
      ]
    });

    console.log(`Found ${listingsWithoutSlugs.length} listings without slugs`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const listing of listingsWithoutSlugs) {
      if (!listing.title) {
        console.log(`⚠️  Skipping listing ${listing._id} - no title`);
        skippedCount++;
        continue;
      }

      try {
        let baseSlug = generateSlug(listing.title);
        let slug = baseSlug;
        let counter = 1;

        // Ensure uniqueness
        while (await Listing.findOne({ slug, _id: { $ne: listing._id } })) {
          slug = `${baseSlug}-${counter}`;
          counter++;
        }

        // Update the listing with the slug
        listing.slug = slug;
        await listing.save();

        console.log(`✅ Updated listing: "${listing.title}"`);
        console.log(`   Slug: ${slug}`);
        updatedCount++;
      } catch (error) {
        console.error(`❌ Error updating listing ${listing._id}:`, error.message);
        skippedCount++;
      }
    }

    console.log('\n✅ Migration complete!');
    console.log(`   Updated: ${updatedCount}`);
    console.log(`   Skipped: ${skippedCount}`);
    console.log(`   Total: ${listingsWithoutSlugs.length}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding slugs:', error);
    process.exit(1);
  }
};

// Run the migration
addSlugsToExistingListings();

