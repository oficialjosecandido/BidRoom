export interface Category {
  id: string;
  name: string;
  icon: string;
  description: string;
  subCategories: string[];
}

export const CATEGORIES: Category[] = [
  {
    id: 'electronics',
    name: 'Electronics',
    icon: '📱',
    description: 'Gadgets, cameras and audio equipment',
    subCategories: [
      'Laptops', 'Desktop Computers', 'Computer Components',
      'Smartphones', 'Tablets', 'Mobile Accessories',
      'Headphones', 'Speakers', 'Hi Fi Systems', 'Turntables',
      'Gaming Consoles', 'Video Games', 'Gaming Accessories',
      'Digital Cameras', 'Film Cameras', 'Camera Lenses', 'Camera Accessories',
      'Televisions', 'Projectors', 'Streaming Devices',
      'Smart Watches', 'Fitness Trackers', 'Wearables Accessories',
      'Other Electronics'
    ]
  },
  {
    id: 'home-garden',
    name: 'Home & Garden',
    icon: '🏠',
    description: 'Furniture, decor and outdoor essentials',
    subCategories: [
      'Tables', 'Chairs', 'Cabinets', 'Shelves', 'Beds',
      'Lamps', 'Mirrors', 'Vases', 'Wall Decor', 'Decorative Objects',
      'Cookware', 'Tableware', 'Glassware', 'Barware',
      'Garden Furniture', 'Garden Tools', 'Outdoor Decor', 'Planters',
      'Rugs', 'Curtains', 'Blankets', 'Cushions',
      'Lighting', 'Other Home & Garden'
    ]
  },
  {
    id: 'art',
    name: 'Art',
    icon: '🎨',
    description: 'Fine art, paintings and sculptures',
    subCategories: [
      'Paintings', 'Drawings', 'Prints', 'Photography',
      'Sculptures', 'Figurines',
      'Other Art'
    ]
  },
  {
    id: 'collectibles',
    name: 'Collectibles',
    icon: '📬',
    description: 'Stamps, coins and rare finds',
    subCategories: [
      'Definitive Stamps', 'Commemorative Stamps', 'Airmail Stamps',
      'Postage Due Stamps', 'Revenue / Fiscal Stamps', 'Official Stamps',
      'Military Mail', 'Local Issues', 'First Day Covers (FDC)',
      'Stamp Booklets', 'Collections / Lots',
      'Classic Stamps (Before 1900)', 'Early 20th Century (1900 to 1945)',
      'Post War (1945 to 1960)', 'Late 20th Century (1960 to 2000)',
      'Modern Stamps (2000 to Present)',
      'Coins & Banknotes', 'Trading Cards', 'Toys & Models',
      'Sports Memorabilia', 'Music Memorabilia', 'Movie Memorabilia',
      'Vintage Items', 'Other Collectibles'
    ]
  },
  {
    id: 'jewelry',
    name: 'Jewelry',
    icon: '💎',
    description: 'Rings, watches and precious gems',
    subCategories: [
      'Engagement Rings', 'Wedding Rings', 'Fashion Rings',
      'Chains', 'Pendants',
      'Bangles', 'Charm Bracelets',
      'Stud Earrings', 'Hoop Earrings', 'Drop Earrings',
      'Luxury Watches', 'Vintage Watches', 'Smart Watches',
      'Brooches & Pins', 'Jewelry Sets', 'Loose Gemstones', 'Other Jewelry'
    ]
  }
];
