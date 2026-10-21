export interface Category {
  id: string;
  name: string;
  icon: string;
  description: string;
  subCategories: string[];
}

/**
 * Categories a giveaway cannot use. Must mirror GIVEAWAY_EXCLUDED in
 * backend/src/config/categories.js — the backend rejects these with
 * giveaway_category_not_allowed, so showing them here only produces a 400
 * after the admin has filled the whole draft.
 */
export const GIVEAWAY_EXCLUDED_IDS = ['vehicles', 'real-estate', 'wine-spirits'];

/**
 * The top-level catalogue, ordered as the browse page shows it.
 *
 * `id` must stay in step with CATEGORY_IDS in backend/src/config/categories.js —
 * it is the slug stored on every listing and in the category-follow records.
 * `name` and `description` are English fallbacks only: the UI reads
 * addListing.categories.* and home.categories.* from the i18n bundles, and
 * every subCategory string is looked up under addListing.subcategories.*.
 *
 * Animal-derived goods are deliberately absent. Taxidermy, hunting trophies,
 * ivory, horn, real fur, exotic skins, tortoiseshell, protected coral and
 * mounted insects are prohibited, which is why the archaeology category is
 * fossils, minerals and antiquities only and carries no natural-history
 * specimens — see PROHIBITED_PATTERNS in backend/src/utils/contentFilter.js.
 */
export const CATEGORIES: Category[] = [
  {
    id: 'jewelry',
    name: 'Jewelry & Watches',
    icon: '💎',
    description: 'Rings, watches, precious gems and writing instruments',
    subCategories: [
      'Engagement Rings', 'Wedding Rings', 'Fashion Rings',
      'Chains', 'Pendants',
      'Bangles', 'Charm Bracelets',
      'Stud Earrings', 'Hoop Earrings', 'Drop Earrings',
      'Luxury Watches', 'Vintage Watches', 'Pocket Watches', 'Smart Watches',
      'Fountain Pens', 'Writing Instruments', 'Lighters', 'Cufflinks',
      'Brooches & Pins', 'Jewelry Sets', 'Loose Gemstones', 'Other Jewelry'
    ]
  },
  {
    id: 'art',
    name: 'Art',
    icon: '🎨',
    description: 'Fine art, tribal and Asian art, sculpture and ceramics',
    subCategories: [
      'Paintings', 'Drawings', 'Prints', 'Photography',
      'Sculptures', 'Figurines',
      'Modern & Contemporary Art', 'Old Master Works',
      'Asian Art', 'Tribal Art', 'African Art', 'Oceanic Art',
      'Icons & Religious Art',
      'Ceramics & Porcelain', 'Glass Art',
      'Other Art'
    ]
  },
  {
    id: 'collectibles',
    name: 'Stamps, Coins & Collectibles',
    icon: '📬',
    description: 'Stamps, coins, trading cards, toys and rare finds',
    subCategories: [
      'Definitive Stamps', 'Commemorative Stamps', 'Airmail Stamps',
      'Postage Due Stamps', 'Revenue / Fiscal Stamps', 'Official Stamps',
      'Military Mail', 'Local Issues', 'First Day Covers (FDC)',
      'Stamp Booklets', 'Collections / Lots',
      'Classic Stamps (Before 1900)', 'Early 20th Century (1900 to 1945)',
      'Post War (1945 to 1960)', 'Late 20th Century (1960 to 2000)',
      'Modern Stamps (2000 to Present)',
      'Coins & Banknotes', 'Ancient Coins', 'Medals & Decorations',
      'Trading Cards', 'Sports Trading Cards', 'Collectible Card Games',
      'Toys & Models', 'Model Railways', 'Scale Models', 'Die-cast Vehicles',
      'Vintage Items', 'Advertising & Signs', 'Other Collectibles'
    ]
  },
  {
    id: 'comics',
    name: 'Comics & Animation',
    icon: '💥',
    description: 'Albums, graphic novels, original art and animation',
    subCategories: [
      'Comic Albums', 'Comic Books', 'Graphic Novels', 'Manga',
      'Original Comic Art', 'Animation Art & Cels',
      'Signed Comics', 'Comic Figurines', 'Comic Collections / Lots',
      'Other Comics & Animation'
    ]
  },
  {
    id: 'books',
    name: 'Books & Manuscripts',
    icon: '📚',
    description: 'Antiquarian books, maps, manuscripts and autographs',
    subCategories: [
      'Antiquarian Books (Before 1800)', 'Rare Books', 'First Editions',
      'Signed Books', 'Illustrated Books', 'Children\'s Books',
      'Atlases & Maps', 'Travel & Exploration',
      'Manuscripts & Documents', 'Autographs', 'Historical Letters',
      'Posters & Ephemera', 'Magazines & Periodicals',
      'Book Collections / Lots', 'Other Books'
    ]
  },
  {
    id: 'music-film',
    name: 'Music & Film',
    icon: '🎬',
    description: 'Vinyl, instruments, posters and screen memorabilia',
    subCategories: [
      'Vinyl Records', 'CDs & Cassettes', 'Record Collections / Lots',
      'Musical Instruments', 'Guitars', 'Stringed Instruments',
      'Wind & Brass Instruments', 'Keyboards & Pianos',
      'Music Memorabilia', 'Signed Music Items', 'Concert Posters',
      'Movie Memorabilia', 'Film Posters', 'Props & Costumes',
      'Signed Film Items', 'Other Music & Film'
    ]
  },
  {
    id: 'archaeology',
    name: 'Archaeology, Fossils & Minerals',
    icon: '🪨',
    description: 'Fossils, minerals, meteorites and antiquities',
    subCategories: [
      'Fossils', 'Ammonites & Trilobites', 'Petrified Wood', 'Amber',
      'Minerals & Crystals', 'Gemstone Specimens', 'Meteorites',
      'Roman Antiquities', 'Greek Antiquities', 'Egyptian Antiquities',
      'Pre-Columbian Artefacts', 'Medieval Artefacts',
      'Other Archaeology'
    ]
  },
  {
    id: 'fashion',
    name: 'Fashion',
    icon: '👜',
    description: 'Designer bags, clothing, shoes and accessories',
    subCategories: [
      'Handbags', 'Designer Handbags', 'Clutches & Evening Bags',
      'Luggage & Travel', 'Wallets & Small Leather Goods',
      'Clothing', 'Outerwear', 'Knitwear', 'Dresses', 'Suits & Tailoring',
      'Shoes', 'Boots', 'Trainers',
      'Scarves & Shawls', 'Belts', 'Hats', 'Gloves',
      'Sunglasses', 'Fashion Jewellery',
      'Vintage Fashion', 'Other Fashion'
    ]
  },
  {
    id: 'sports',
    name: 'Sports',
    icon: '⚽',
    description: 'Memorabilia, match-worn shirts and sporting equipment',
    subCategories: [
      'Football Memorabilia', 'Match-Worn Shirts', 'Signed Sports Items',
      'Sports Memorabilia', 'Sports Programmes & Tickets',
      'Cycling', 'Golf', 'Tennis & Racket Sports',
      'Winter Sports', 'Water Sports', 'Fishing',
      'Motorsport Memorabilia', 'Boxing & Martial Arts',
      'Fitness Equipment', 'Other Sports'
    ]
  },
  {
    id: 'wine-spirits',
    name: 'Wine & Spirits',
    icon: '🍷',
    description: 'Port, Madeira, fine wine, whisky and rare spirits',
    subCategories: [
      'Port Wine', 'Madeira Wine', 'Portuguese Wine',
      'Red Wine', 'White Wine', 'Rosé Wine',
      'Sparkling Wine & Champagne', 'Dessert & Fortified Wine',
      'Whisky', 'Cognac & Brandy', 'Rum', 'Gin & Vodka',
      'Liqueurs', 'Aguardente & Bagaço',
      'Wine Collections / Lots', 'Wine Accessories', 'Other Wine & Spirits'
    ]
  },
  {
    id: 'home-garden',
    name: 'Home & Garden',
    icon: '🏠',
    description: 'Furniture, antiques, decor and outdoor essentials',
    subCategories: [
      'Tables', 'Chairs', 'Cabinets', 'Shelves', 'Beds',
      'Antique Furniture', 'Design Furniture',
      'Lamps', 'Lighting', 'Mirrors', 'Clocks',
      'Vases', 'Wall Decor', 'Decorative Objects',
      'Porcelain & Pottery', 'Silver & Silverplate',
      'Cookware', 'Tableware', 'Glassware', 'Barware',
      'Garden Furniture', 'Garden Tools', 'Outdoor Decor', 'Planters',
      'Rugs', 'Tapestries', 'Curtains', 'Blankets', 'Cushions',
      'Other Home & Garden'
    ]
  },
  {
    id: 'electronics',
    name: 'Electronics',
    icon: '📱',
    description: 'Gadgets, cameras, audio and gaming',
    subCategories: [
      'Laptops', 'Desktop Computers', 'Computer Components',
      'Smartphones', 'Tablets', 'Mobile Accessories',
      'Headphones', 'Speakers', 'Hi Fi Systems', 'Turntables',
      'Gaming Consoles', 'Video Games', 'Gaming Accessories',
      'Digital Cameras', 'Film Cameras', 'Vintage Cameras',
      'Camera Lenses', 'Camera Accessories',
      'Televisions', 'Projectors', 'Streaming Devices',
      'Smart Watches', 'Fitness Trackers', 'Wearables Accessories',
      'Other Electronics'
    ]
  },
  {
    id: 'vehicles',
    name: 'Vehicles',
    icon: '🚗',
    description: 'Cars, motorcycles, boats and automobilia',
    subCategories: [
      'Cars', 'Classic Cars', 'Electric & Hybrid Cars',
      'Motorcycles', 'Classic Motorcycles', 'Scooters & Mopeds',
      'Vans & Minibuses', 'Trucks & HGV',
      'Boats', 'Jet Skis & Watercraft', 'Sailboats',
      'Caravans & Motorhomes', 'ATVs & Quad Bikes',
      'Bicycles',
      'Automobilia', 'Vehicle Parts', 'Vehicle Accessories', 'Other Vehicles'
    ]
  },
  {
    id: 'real-estate',
    name: 'Real Estate',
    icon: '🏢',
    description: 'Apartments, houses and land',
    subCategories: [
      'Apartments', 'Studios', 'Duplexes & Penthouses',
      'Houses', 'Villas', 'Townhouses',
      'Land & Plots', 'Rural & Countryside',
      'Commercial Property', 'Office Space', 'Industrial & Warehouse',
      'Garages & Parking', 'Holiday Homes', 'Other Real Estate'
    ]
  }
];
