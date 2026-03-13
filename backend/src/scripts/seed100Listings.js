/**
 * Seed 100 mock listings across all categories.
 * Usage: node src/scripts/seed100Listings.js
 */

require('dotenv').config();
const connectDB = require('../config/database');
const Listing = require('../models/Listing');
const User = require('../models/User');

const PLACEHOLDER_IMAGE = 'https://img.freepik.com/premium-vector/auction-logo-initial-letter-design-template-inspiration_340145-109.jpg';

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const conditions = ['New', 'Used - Excellent', 'Used - Very Good', 'Used - Good'];

const listingsData = [
  // ── Electronics (25) ──────────────────────────────────────────────────────
  { title: 'Apple MacBook Pro 14" M3 Pro', category: 'electronics', subCategory: 'Laptops', price: 1899, desc: 'Barely used MacBook Pro with M3 Pro chip, 18GB RAM, 512GB SSD. Space Grey. Original box and accessories included. Perfect condition with no scratches.', condition: 'Used - Excellent', hours: 48 },
  { title: 'Dell XPS 15 OLED Touch 2023', category: 'electronics', subCategory: 'Laptops', price: 1249, desc: 'Dell XPS 15 with stunning OLED touchscreen, Intel Core i7-13700H, 32GB RAM, 1TB NVMe SSD. Excellent battery life. Minor wear on the base.', condition: 'Used - Very Good', hours: 72 },
  { title: 'Lenovo ThinkPad X1 Carbon Gen 11', category: 'electronics', subCategory: 'Laptops', price: 899, desc: 'Lightweight business powerhouse. Intel Core i5-1345U, 16GB RAM, 512GB SSD. Includes docking station. A few light marks from regular use.', condition: 'Used - Good', hours: 24 },
  { title: 'ASUS ROG Zephyrus G14 Gaming Laptop', category: 'electronics', subCategory: 'Laptops', price: 1450, desc: 'AMD Ryzen 9 7940HS, RTX 4060 8GB, 16GB RAM, 1TB SSD. 165Hz QHD display. Great for gaming and creative work. Comes with original charger.', condition: 'Used - Excellent', hours: 96 },

  { title: 'Sony PlayStation 5 Disc Edition', category: 'electronics', subCategory: 'Gaming Consoles', price: 420, desc: 'PS5 Disc Edition with two DualSense controllers. Includes Spider-Man 2 and God of War Ragnarok. All cables and stand included. Works perfectly.', condition: 'Used - Excellent', hours: 30 },
  { title: 'Nintendo Switch OLED White', category: 'electronics', subCategory: 'Gaming Consoles', price: 280, desc: 'Nintendo Switch OLED in white, complete with dock, Joy-Con controllers and all accessories. Screen is pristine. Selling with 5 game cartridges.', condition: 'Used - Very Good', hours: 60 },
  { title: 'Xbox Series X 1TB Console', category: 'electronics', subCategory: 'Gaming Consoles', price: 350, desc: 'Xbox Series X in excellent condition. Includes one wireless controller, HDMI cable and power cable. No scratches. Original box available.', condition: 'Used - Excellent', hours: 120 },

  { title: 'Sony WH-1000XM5 Wireless Headphones', category: 'electronics', subCategory: 'Headphones', price: 220, desc: 'Industry-leading noise cancellation, 30-hour battery life, crystal clear call quality. Black colourway. Includes carry case and cables.', condition: 'Used - Excellent', hours: 36 },
  { title: 'Apple AirPods Pro 2nd Generation', category: 'electronics', subCategory: 'Headphones', price: 175, desc: 'AirPods Pro 2 with MagSafe charging case. Active noise cancellation, transparency mode, USB-C charging. Minor case scuffs but pods immaculate.', condition: 'Used - Very Good', hours: 54 },
  { title: 'Bose SoundLink Max Portable Speaker', category: 'electronics', subCategory: 'Speakers', price: 290, desc: 'Bose SoundLink Max with 20+ hour battery. IP67 waterproof, built-in handle. Rich, full 360° sound. Perfect for outdoors. Barely used.', condition: 'Used - Excellent', hours: 42 },

  { title: 'Leica M6 35mm Film Camera', category: 'electronics', subCategory: 'Film Cameras', price: 2200, desc: 'Classic Leica M6 TTL in chrome finish. Includes Leica Summicron 35mm f/2 lens. Recently serviced by Leica UK. Light seals replaced. Excellent working condition.', condition: 'Used - Very Good', hours: 168 },
  { title: 'Canon EOS R5 Mirrorless Camera Body', category: 'electronics', subCategory: 'Digital Cameras', price: 2800, desc: '45MP full-frame sensor, 8K RAW video, in-body stabilisation. Approx. 12,000 actuations. Comes with body cap and original accessories. No damage.', condition: 'Used - Excellent', hours: 144 },
  { title: 'Nikon Z 50mm f/1.4 S Lens', category: 'electronics', subCategory: 'Camera Lenses', price: 580, desc: 'Nikon Nikkor Z 50mm f/1.4 S — tack-sharp prime with beautiful bokeh. No fungus, no scratches on glass. Front and rear caps included.', condition: 'Used - Excellent', hours: 80 },
  { title: 'Fujifilm X100VI Limited Edition', category: 'electronics', subCategory: 'Digital Cameras', price: 1600, desc: 'Fujifilm X100VI in black. 40.2MP, in-body stabilisation, built-in ND filter. Shutter count under 500. Original box, extra battery and Fuji leather case.', condition: 'New', hours: 48 },

  { title: 'Samsung 65" QLED 4K Smart TV QN90C', category: 'electronics', subCategory: 'Televisions', price: 950, desc: 'Samsung Neo QLED 4K, 120Hz, Dolby Atmos, Gaming Hub. One Connect Box. Wall mount bracket included. Purchased 6 months ago, upgrading to larger size.', condition: 'Used - Excellent', hours: 96 },
  { title: 'LG C3 55" OLED 4K TV', category: 'electronics', subCategory: 'Televisions', price: 720, desc: 'LG OLED C3, perfect blacks, 120Hz, G-Sync and FreeSync compatible. Ideal for gaming and movies. Original remote and stand legs included.', condition: 'Used - Very Good', hours: 72 },

  { title: 'iPhone 15 Pro Max 256GB Titanium', category: 'electronics', subCategory: 'Smartphones', price: 980, desc: 'Apple iPhone 15 Pro Max in Natural Titanium. 256GB storage. Battery at 94% health. Original box, charger cable included. No Face ID issues. Unlocked.', condition: 'Used - Excellent', hours: 40 },
  { title: 'Samsung Galaxy S24 Ultra 512GB', category: 'electronics', subCategory: 'Smartphones', price: 850, desc: 'Samsung Galaxy S24 Ultra in Titanium Gray. 512GB storage, S Pen included. SIM-free. Minor micro-scratches on back under case. Screen flawless.', condition: 'Used - Very Good', hours: 56 },

  { title: 'Apple iPad Pro 13" M4 Wi-Fi 256GB', category: 'electronics', subCategory: 'Tablets', price: 1050, desc: 'iPad Pro M4 with Liquid Retina XDR display. Space Black. 256GB. Includes Apple Pencil Pro and Magic Keyboard. Minimal use — like new.', condition: 'Used - Excellent', hours: 64 },

  { title: 'Apple Watch Ultra 2 Black Titanium', category: 'electronics', subCategory: 'Smart Watches', price: 680, desc: 'Apple Watch Ultra 2 in black titanium with Ocean Band. GPS + Cellular. Battery health 97%. Excellent condition with minor band wear. Original box included.', condition: 'Used - Excellent', hours: 88 },

  { title: 'Technics SL-1200MK7 Direct Drive Turntable', category: 'electronics', subCategory: 'Turntables', price: 850, desc: 'Legendary Technics 1200 series, direct-drive motor, high torque for DJ and audiophile use. Includes dust cover and Ortofon 2M Red cartridge. Barely used.', condition: 'Used - Excellent', hours: 120 },

  { title: 'Raspberry Pi 5 8GB + Starter Kit', category: 'electronics', subCategory: 'Computer Components', price: 95, desc: 'Raspberry Pi 5 8GB RAM with official active cooler, 64GB SD card, 5V power supply, and case. Perfect for home automation or learning projects.', condition: 'New', hours: 36 },

  { title: 'Rode PodMic USB Dynamic Microphone', category: 'electronics', subCategory: 'Other Electronics', price: 125, desc: 'Rode PodMic USB — professional broadcast-quality microphone. Cardioid polar pattern, internal pop filter. Ideal for podcasting, streaming, and voice-over work.', condition: 'New', hours: 48 },

  { title: 'DJI Mini 4 Pro Drone Combo', category: 'electronics', subCategory: 'Camera Accessories', price: 760, desc: 'DJI Mini 4 Pro Fly More Combo. Omnidirectional obstacle sensing, 4K/60fps, 34-min flight time. 3 batteries. 5 total flights. Includes bag and ND filter set.', condition: 'Used - Excellent', hours: 96 },

  { title: 'Elgato Stream Deck XL', category: 'electronics', subCategory: 'Gaming Accessories', price: 140, desc: '32 customisable LCD keys for streaming, editing, or productivity automation. USB-C connection, detachable cable. Perfect condition, drivers installed.', condition: 'Used - Excellent', hours: 60 },

  // ── Home & Garden (20) ────────────────────────────────────────────────────
  { title: 'Vintage Eames Style Lounge Chair & Ottoman', category: 'home-garden', subCategory: 'Chairs', price: 680, desc: 'Mid-century modern lounge chair and ottoman in tan leather. Walnut veneer shell in excellent condition. Extremely comfortable and a real statement piece.', condition: 'Used - Very Good', hours: 168 },
  { title: 'Solid Oak Dining Table — Seats 8', category: 'home-garden', subCategory: 'Tables', price: 450, desc: 'Handcrafted solid oak dining table, 200cm × 90cm. Natural oil finish. Some light marks on surface but structurally perfect. Buyers to collect or arrange courier.', condition: 'Used - Good', hours: 96 },
  { title: 'IKEA KALLAX 4×4 Shelf Unit White', category: 'home-garden', subCategory: 'Shelves', price: 80, desc: 'IKEA KALLAX 4×4 shelf unit in white, 147×147cm. Perfect for record storage, books, or display. All 16 cubbies intact. A few minor scuffs on back panel.', condition: 'Used - Good', hours: 48 },
  { title: 'Walnut Bedside Tables — Pair', category: 'home-garden', subCategory: 'Tables', price: 220, desc: 'Matching pair of walnut veneer bedside tables with single drawer. Hairpin legs. Dimensions: 50×40×55cm. Barely used, from a room renovation.', condition: 'Used - Excellent', hours: 72 },
  { title: 'Danish Modern Teak Sideboard 1960s', category: 'home-garden', subCategory: 'Cabinets', price: 740, desc: 'Authentic Danish teak sideboard circa 1965. 180cm wide, three sliding doors, original brass handles. Lovely patina. A few surface scratches consistent with age.', condition: 'Used - Very Good', hours: 120 },

  { title: 'Tom Dixon Melt Pendant Light Gold', category: 'home-garden', subCategory: 'Lamps', price: 320, desc: 'Genuine Tom Dixon Melt Pendant in gold. 50cm diameter. Striking molten finish creates beautiful light patterns. One previous owner. E27 bulb included.', condition: 'Used - Excellent', hours: 80 },
  { title: 'Vintage Brass Floor Lamp Mid-Century', category: 'home-garden', subCategory: 'Lamps', price: 145, desc: 'Elegant brass floor lamp with adjustable boom arm and white linen shade. Rewired to UK standards. 155cm tall. Perfect in a reading corner or bedroom.', condition: 'Used - Very Good', hours: 64 },
  { title: 'Large Antique Gilt Overmantle Mirror', category: 'home-garden', subCategory: 'Mirrors', price: 390, desc: 'Impressive gilt-framed overmantle mirror, 120×90cm. Some foxing to glass edges consistent with age. Solid and heavy — collection preferred from London SW.', condition: 'Used - Good', hours: 96 },
  { title: 'Handmade Ceramic Vase Set of 3', category: 'home-garden', subCategory: 'Vases', price: 75, desc: 'Set of three handmade stoneware vases in muted earth tones. Heights: 32cm, 22cm, 14cm. No chips or cracks. Perfect display pieces.', condition: 'New', hours: 48 },
  { title: 'Banksy-Style Street Art Print Framed', category: 'home-garden', subCategory: 'Wall Decor', price: 180, desc: 'High-quality giclée print of balloon girl artwork, A2 size, professionally framed in black aluminium. Bold statement piece for any living space.', condition: 'New', hours: 72 },

  { title: 'Le Creuset Cast Iron Round Casserole 26cm', category: 'home-garden', subCategory: 'Cookware', price: 125, desc: 'Le Creuset 26cm round casserole in Marseille Blue. Barely used — just too large for current household. No chips to enamel. Lid fits perfectly.', condition: 'Used - Excellent', hours: 36 },
  { title: 'Vintage English Bone China Dinner Service 40-Piece', category: 'home-garden', subCategory: 'Tableware', price: 210, desc: 'Complete 40-piece English bone china service for 8. Floral pattern with gold rim. Some light utensil marks on dinner plates. Very elegant.', condition: 'Used - Good', hours: 120 },
  { title: 'KitchenAid Stand Mixer 6.9L Pistachio', category: 'home-garden', subCategory: 'Cookware', price: 380, desc: 'KitchenAid Artisan Bowl-Lift Stand Mixer in Pistachio Green. 6.9L stainless bowl. Comes with dough hook, flat beater, wire whip. All original attachments.', condition: 'Used - Excellent', hours: 56 },
  { title: 'Vintage Whisky Decanter Set', category: 'home-garden', subCategory: 'Glassware', price: 95, desc: 'Cut-crystal whisky decanter with six matching tumblers. Art Deco geometric pattern. One tumbler has a tiny chip on base rim (does not affect use). Stopper fits.', condition: 'Used - Good', hours: 72 },

  { title: 'Teak Garden Table & 4 Stacking Chairs', category: 'home-garden', subCategory: 'Garden Furniture', price: 520, desc: 'Grade A teak garden dining set. Round table 120cm diameter + 4 folding chairs. Weathered to a lovely silver-grey. Structurally excellent. Buyer collects.', condition: 'Used - Very Good', hours: 96 },
  { title: 'Large Terracotta Olive Jar Planter', category: 'home-garden', subCategory: 'Planters', price: 140, desc: 'Authentic aged terracotta olive jar, 70cm tall. Beautiful weathered patina. Perfect statement piece for patio or garden entrance. Drainage hole at base.', condition: 'Used - Good', hours: 48 },

  { title: 'Beni Ourain Moroccan Wool Rug 200×140cm', category: 'home-garden', subCategory: 'Rugs', price: 280, desc: 'Authentic hand-knotted Beni Ourain rug in natural ivory wool with black geometric pattern. 200×140cm. Soft and thick pile. One careful previous owner.', condition: 'Used - Very Good', hours: 80 },
  { title: 'Silk Velvet Curtains — Pair Midnight Blue', category: 'home-garden', subCategory: 'Curtains', price: 160, desc: 'Pair of lined silk velvet curtains in midnight blue. 230cm drop × 140cm each panel. Eyelet heading. Barely used. Dry cleaned before listing.', condition: 'Used - Excellent', hours: 64 },

  { title: 'Mongolian Lamb Throw Blanket Ivory', category: 'home-garden', subCategory: 'Blankets', price: 85, desc: 'Luxuriously soft genuine Mongolian lamb faux-fur throw in ivory. 130×180cm. Perfect for sofa or bed. Dry clean only label present. No shedding.', condition: 'New', hours: 36 },
  { title: 'Antique Cast Iron Garden Bench', category: 'home-garden', subCategory: 'Garden Furniture', price: 310, desc: 'Victorian-style cast iron bench with original slatted teak seat. 130cm wide. Recently repainted in matt black. Some surface rust in decorative crevices. Heavy.', condition: 'Used - Good', hours: 72 },

  // ── Art (15) ──────────────────────────────────────────────────────────────
  { title: 'Original Oil on Canvas — Abstract Coastal', category: 'art', subCategory: 'Paintings', price: 650, desc: 'Original oil on linen, 80×60cm, unframed. Bold gestural marks in blues, ochres and whites evoke a stormy coast. Signed lower right. Certificate of authenticity included.', condition: 'New', hours: 168 },
  { title: 'Watercolour Botanical Study — Framed', category: 'art', subCategory: 'Paintings', price: 240, desc: 'Original watercolour study of wildflowers on 300gsm Arches paper. A4 size, mounted and framed in natural oak. Signed and dated. Lovely gift piece.', condition: 'New', hours: 96 },
  { title: 'Large Format Acrylic Abstract Diptych', category: 'art', subCategory: 'Paintings', price: 1100, desc: 'Pair of large canvases, 100×80cm each. Bold abstract expressionism in crimson, black and gold leaf. Gallery-wrapped. Sold as a set. Ready to hang.', condition: 'New', hours: 144 },
  { title: 'Charcoal Portrait Drawing — Original', category: 'art', subCategory: 'Drawings', price: 380, desc: 'Original charcoal on cartridge paper, 50×70cm. Figurative portrait of a woman in repose. Exceptional draughtsmanship. Signed and framed under glass.', condition: 'New', hours: 120 },
  { title: 'Pencil Architectural Drawing 19th Century', category: 'art', subCategory: 'Drawings', price: 290, desc: 'Detailed 19th-century architectural elevation drawing in pencil, likely of a country house. Framed and mounted. Provenance from a country estate auction 2003.', condition: 'Used - Good', hours: 96 },

  { title: 'Limited Edition Screen Print — Urban Series', category: 'art', subCategory: 'Prints', price: 185, desc: 'Numbered 12/50 screen print of London cityscape at night. Hand-printed on 300gsm Somerset Velvet paper. Signed by artist. 42×59cm unframed.', condition: 'New', hours: 72 },
  { title: 'Andy Warhol Marilyn Authentic Lithograph', category: 'art', subCategory: 'Prints', price: 880, desc: 'Authenticated lithograph from the 1967 Marilyn Monroe portfolio. From a private collection with documentation. Framed in gallery-quality aluminium frame.', condition: 'Used - Excellent', hours: 168 },
  { title: 'Japanese Woodblock Print — Meiji Period', category: 'art', subCategory: 'Prints', price: 420, desc: 'Original Meiji-period woodblock print depicting Mount Fuji at dawn. 38×28cm including margins. Some foxing at corners. Professionally mounted.', condition: 'Used - Good', hours: 144 },

  { title: 'Fine Art Photography Print — Highlands', category: 'art', subCategory: 'Photography', price: 320, desc: 'Fine art giclée print by Scottish photographer. Misty Highland loch at sunrise. 70×50cm, printed on Hahnemühle Photo Rag 308gsm. Edition 3/20. Unframed.', condition: 'New', hours: 96 },
  { title: 'Vintage Silver Gelatin Print 1940s', category: 'art', subCategory: 'Photography', price: 260, desc: 'Original silver gelatin photograph from the 1940s, portrait of a jazz musician. 25×20cm. Some silver mirroring at edges. Mounted on original card backing.', condition: 'Used - Good', hours: 80 },

  { title: 'Bronze Resin Sculpture — Reclining Figure', category: 'art', subCategory: 'Sculptures', price: 780, desc: 'Cold-cast bronze resin, Moore-inspired reclining figure. 45cm long, 2.8kg. Limited edition 7/25, signed and numbered base. Includes certificate.', condition: 'New', hours: 144 },
  { title: 'Hand-Carved African Ebony Wood Sculpture', category: 'art', subCategory: 'Sculptures', price: 345, desc: 'Hand-carved ebony wood sculpture depicting a seated elder. 35cm tall. Sourced ethically in Nairobi, 1990s. Beautiful grain and patina from handling.', condition: 'Used - Very Good', hours: 96 },

  { title: 'Royal Doulton Character Figurine — Old Balloon Seller', category: 'art', subCategory: 'Figurines', price: 120, desc: 'Royal Doulton HN1315 Old Balloon Seller figurine. First colourway. Some crazing to base glaze consistent with age. No chips or cracks. Retired edition.', condition: 'Used - Good', hours: 72 },
  { title: 'Meissen Porcelain Shepherd Figurine 18th C.', category: 'art', subCategory: 'Figurines', price: 960, desc: 'Early Meissen porcelain shepherd with crossed-swords mark. Circa 1740-1760. Restored left hand and crook. Overall very presentable. Comes with provenance documents.', condition: 'Used - Good', hours: 168 },
  { title: 'Contemporary Ceramic Sculpture — Abstract Form', category: 'art', subCategory: 'Sculptures', price: 430, desc: 'Hand-built stoneware sculpture, organic abstract form in satin black glaze. One-off piece by gallery-exhibited ceramicist. Signed. 40cm tall.', condition: 'New', hours: 120 },

  // ── Collectibles (20) ─────────────────────────────────────────────────────
  { title: 'Penny Black 1840 — Used Example', category: 'collectibles', subCategory: 'Stamps', price: 180, desc: 'World\'s first adhesive postage stamp, 1840 Penny Black. Four margins, red Maltese cross cancellation. Small thin at top right. SG2, cat. value £275 used.', condition: 'Used - Good', hours: 168 },
  { title: 'Great Britain Victorian Stamp Collection', category: 'collectibles', subCategory: 'Stamps', price: 340, desc: 'Album of 180+ GB Victorian stamps including surface-printed issues. All identified with SG numbers. Several penny reds, including plate numbers. CV estimated £600+.', condition: 'Used - Good', hours: 120 },
  { title: '1966 World Cup Winners Commemorative Set', category: 'collectibles', subCategory: 'Stamps', price: 95, desc: 'Complete set of four commemorative stamps from the 1966 World Cup. Mounted in original first day cover. Very fine condition. Great piece of football history.', condition: 'Used - Very Good', hours: 96 },

  { title: '1933 US Double Eagle $20 Gold Coin', category: 'collectibles', subCategory: 'Coins & Banknotes', price: 3200, desc: 'Rare pre-1933 American Double Eagle $20 gold coin, MS-62 grade (NGC slabbed). Beautiful strike with significant lustre remaining. Comes with NGC certificate.', condition: 'Used - Excellent', hours: 168 },
  { title: 'UK Pre-Decimal Coin Collection 1800s–1960s', category: 'collectibles', subCategory: 'Coins & Banknotes', price: 165, desc: 'Collection of 85 pre-decimal British coins from Victoria to Elizabeth II. Includes half-crowns, florins, shillings, and pennies. Album included.', condition: 'Used - Good', hours: 72 },
  { title: 'Uncirculated £5 White Bank of England Note 1956', category: 'collectibles', subCategory: 'Coins & Banknotes', price: 280, desc: 'Bank of England £5 white note series, L. K. O\'Brien Chief Cashier. Near uncirculated condition. Light fold only. Rare in this condition.', condition: 'Used - Excellent', hours: 96 },

  { title: 'Pokémon Base Set Booster Pack — Charizard Art', category: 'collectibles', subCategory: 'Trading Cards', price: 420, desc: 'Sealed Pokémon 1st Edition Base Set booster pack with Charizard artwork. Factory sealed. Weight suggests excellent contents. Stored in sleeve since purchase.', condition: 'New', hours: 168 },
  { title: 'PSA 10 Charizard Base Set Unlimited Holo', category: 'collectibles', subCategory: 'Trading Cards', price: 1850, desc: 'PSA 10 Gem Mint Charizard from 1999 Base Set Unlimited. Graded by PSA in 2021. Stunning card with no wear. PSA population: only 3% receive a 10.', condition: 'New', hours: 168 },
  { title: '2023 Topps Chrome Baseball Complete Set', category: 'collectibles', subCategory: 'Trading Cards', price: 85, desc: 'Complete 2023 Topps Chrome Baseball set, 200 base cards + all refractors. Stored in individual card sleeves in a binder. No duplicates.', condition: 'New', hours: 48 },

  { title: 'Rare Dinky Toys Bentley "S" Series 1950s', category: 'collectibles', subCategory: 'Toys & Models', price: 145, desc: 'Dinky Toys No. 194 Bentley S-Type in cream, all original paint. Minor paint chips to roof and bumpers. Original box in poor condition. Wheels intact.', condition: 'Used - Good', hours: 96 },
  { title: 'Märklin HO Gauge Steam Locomotive Set', category: 'collectibles', subCategory: 'Toys & Models', price: 380, desc: 'Märklin 37020 HO gauge BR 05 steam locomotive set with three coaches, transformers and 5m of track. Digital decoder. Perfect working order.', condition: 'Used - Excellent', hours: 120 },

  { title: 'George Best Signed Manchester United Shirt 1968', category: 'collectibles', subCategory: 'Sports Memorabilia', price: 2400, desc: 'Match-worn Manchester United shirt signed by George Best, season approx. 1967-68. Authenticated by AFTAL dealer. LOA included. Framed for display.', condition: 'Used - Good', hours: 168 },
  { title: 'Muhammad Ali Signed Boxing Glove', category: 'collectibles', subCategory: 'Sports Memorabilia', price: 1600, desc: 'Everlast boxing glove signed in black marker by Muhammad Ali. PSA/DNA authenticated. Full LOA included. Displayed in acrylic case.', condition: 'Used - Excellent', hours: 144 },
  { title: 'Wimbledon 1980 Final Programme — Signed', category: 'collectibles', subCategory: 'Sports Memorabilia', price: 320, desc: 'Official Wimbledon 1980 Men\'s Final programme signed by Björn Borg and John McEnroe. A historic rivalry on one piece. Authenticated by Beckett.', condition: 'Used - Very Good', hours: 96 },

  { title: 'The Beatles — White Album UK 1st Pressing', category: 'collectibles', subCategory: 'Music Memorabilia', price: 280, desc: 'The Beatles White Album, UK first pressing (PMC 7067/8), mono. Low serial number #0045321. Includes all 4 photos and poster. Vinyl VG+, sleeve VG.', condition: 'Used - Good', hours: 120 },
  { title: 'David Bowie Ziggy Stardust Tour Programme 1973', category: 'collectibles', subCategory: 'Music Memorabilia', price: 195, desc: 'Original 1972-73 Ziggy Stardust World Tour programme. Some creasing to covers and spine but complete. One of the most iconic rock tours in history.', condition: 'Used - Good', hours: 80 },

  { title: 'Star Wars A New Hope Original UK Quad Poster', category: 'collectibles', subCategory: 'Movie Memorabilia', price: 640, desc: 'Original 1977 UK quad cinema poster for Star Wars Episode IV. Tom Chantrell artwork. 762×1016mm. Some fold lines and small tear at bottom edge. Stunning.', condition: 'Used - Good', hours: 144 },

  { title: 'Victorian Sterling Silver Card Case', category: 'collectibles', subCategory: 'Vintage Items', price: 185, desc: 'Hallmarked sterling silver visiting card case, Birmingham 1887. Engraved floral decoration to front and back. Hinge and clasp work perfectly. 8×5.5cm.', condition: 'Used - Very Good', hours: 96 },
  { title: 'Art Deco Chrome Cocktail Shaker Set', category: 'collectibles', subCategory: 'Vintage Items', price: 140, desc: 'Complete Art Deco chrome cocktail shaker (750ml) with 6 matching cups and original tray. Minor surface scuffs. Great for display or entertaining.', condition: 'Used - Good', hours: 72 },
  { title: '1960s Esso Petrol Advertising Enamel Sign', category: 'collectibles', subCategory: 'Vintage Items', price: 210, desc: 'Original enamel advertising sign for Esso, circa 1960s. 60×45cm. Some chipping at edges and corners. Background vibrant. Great garage or shed display piece.', condition: 'Used - Good', hours: 96 },

  // ── Jewelry (20) ──────────────────────────────────────────────────────────
  { title: '18ct Diamond Solitaire Engagement Ring 1.2ct', category: 'jewelry', subCategory: 'Engagement Rings', price: 3800, desc: '18ct white gold diamond solitaire, round brilliant cut 1.20ct, G colour, VS2 clarity (GIA certificated). Size N½. No scratches on band. Accompanied by original receipt.', condition: 'Used - Excellent', hours: 168 },
  { title: 'Antique Edwardian Sapphire Diamond Ring', category: 'jewelry', subCategory: 'Fashion Rings', price: 1450, desc: 'Edwardian circa 1910 platinum ring with central Ceylon sapphire (approx 1.8ct) surrounded by old mine-cut diamonds in an openwork mount. Size L. Comes with gem report.', condition: 'Used - Very Good', hours: 144 },
  { title: 'Art Deco Aquamarine Cocktail Ring', category: 'jewelry', subCategory: 'Fashion Rings', price: 620, desc: 'Platinum Art Deco ring with large rectangular step-cut aquamarine (approx 6ct) flanked by diamond baguettes. Size M. A few minor prong tip repairs visible.', condition: 'Used - Good', hours: 120 },

  { title: 'Victorian Gold Guard Chain 9ct 60 inches', category: 'jewelry', subCategory: 'Chains', price: 380, desc: '9ct gold Albert-style guard chain, 60 inches (152cm). Hallmarked throughout, Birmingham c.1895. With swivel clip and T-bar. Total weight 42.5g.', condition: 'Used - Very Good', hours: 96 },
  { title: 'Diamond Pavé Tennis Necklace 18ct White Gold', category: 'jewelry', subCategory: 'Chains', price: 2100, desc: '18ct white gold diamond tennis necklace, 4.50ct total diamond weight (G/VS). 42cm, box clasp with safety catch. Independent valuation £3,500 available.', condition: 'Used - Excellent', hours: 144 },
  { title: 'Georgian Seed Pearl Flower Pendant', category: 'jewelry', subCategory: 'Pendants', price: 290, desc: 'Georgian gold-pinchbeck flower pendant set with seed pearls and a central foiled garnet. Original fitted box. Circa 1800-1820. Some petals missing seed pearls.', condition: 'Used - Good', hours: 96 },

  { title: 'Cartier Love Bracelet 18ct Yellow Gold Size 18', category: 'jewelry', subCategory: 'Bangles', price: 4800, desc: 'Authentic Cartier Love bracelet in 18ct yellow gold, size 18. Complete with original screwdriver, box and papers. Some light surface scratches from wear.', condition: 'Used - Very Good', hours: 168 },
  { title: 'Victorian 15ct Gold Engraved Bangle', category: 'jewelry', subCategory: 'Bangles', price: 440, desc: 'Antique 15ct gold bangle with beautiful engine-turned engraving and bright-cut detail. Internal diameter 6.2cm. Hallmarked. Weight 8.2g. No cracks or repairs.', condition: 'Used - Very Good', hours: 72 },
  { title: 'Multi-Strand Baroque Pearl Charm Bracelet', category: 'jewelry', subCategory: 'Charm Bracelets', price: 175, desc: 'Sterling silver charm bracelet with baroque freshwater pearl stations and six gold-filled charms. 19cm adjustable length. Perfect for layering.', condition: 'New', hours: 48 },

  { title: 'Tiffany & Co. Diamond Stud Earrings 0.50ct Total', category: 'jewelry', subCategory: 'Stud Earrings', price: 860, desc: 'Tiffany & Co. round brilliant diamond studs in platinum, 0.25ct each, E/VVS1. Original pouch, box and GIA certificates. Butterfly pushbacks. Minimal wear.', condition: 'Used - Excellent', hours: 144 },
  { title: 'Victorian Coral and Gold Drop Earrings', category: 'jewelry', subCategory: 'Drop Earrings', price: 320, desc: 'Pair of 15ct gold earrings set with carved coral cameos depicting classical profiles. French hook fittings. Circa 1870. One tiny hairline crack in one cameo.', condition: 'Used - Good', hours: 96 },
  { title: 'Large Gold Hoop Earrings 14ct 40mm', category: 'jewelry', subCategory: 'Hoop Earrings', price: 195, desc: '14ct yellow gold hoop earrings, 40mm diameter, hinged post fitting. Hallmarked. Weight 6.8g pair. Very wearable classic style. No damage.', condition: 'Used - Excellent', hours: 60 },

  { title: 'Rolex Datejust 36 Steel Jubilee 126200', category: 'jewelry', subCategory: 'Luxury Watches', price: 8200, desc: 'Rolex Datejust 36 ref. 126200, silver stick dial, Jubilee bracelet. 2022 full set with box, papers and stickers. Worn lightly. Service record up to date.', condition: 'Used - Excellent', hours: 168 },
  { title: 'Omega Seamaster 300M 007 Edition', category: 'jewelry', subCategory: 'Luxury Watches', price: 3400, desc: 'Omega Seamaster 300M 60th Anniversary James Bond edition. Full set with extra rubber strap. 50 hours power reserve. Unworn display watch only.', condition: 'New', hours: 144 },
  { title: 'Vintage Jaeger-LeCoultre Reverso 1960s', category: 'jewelry', subCategory: 'Vintage Watches', price: 2800, desc: 'JLC Reverso manual wind from approx. 1965. Yellow gold-plated case, white dial, blued hands. Recently serviced by JLC-trained watchmaker. Stunning patina.', condition: 'Used - Very Good', hours: 168 },
  { title: 'Vintage Seiko 6139 Pogue Chronograph', category: 'jewelry', subCategory: 'Vintage Watches', price: 480, desc: 'Seiko 6139-6002 "Pogue" chronograph from 1972, worn in orbit. Yellow dial with day-date. Fully serviced, keeping excellent time. Original bracelet with extra links.', condition: 'Used - Very Good', hours: 96 },

  { title: 'Victorian Mourning Brooch Hair Memorial', category: 'jewelry', subCategory: 'Brooches & Pins', price: 165, desc: 'Victorian black vulcanite oval brooch with memorial hair compartment behind glazed back. Gold-coloured clasp. Intact and beautiful example of mourning jewellery.', condition: 'Used - Good', hours: 72 },
  { title: 'Chanel Camellia Crystal Brooch', category: 'jewelry', subCategory: 'Brooches & Pins', price: 320, desc: 'Chanel-inspired camellia brooch in gilded metal pavé with clear crystals. 7cm diameter. No stones missing. Original hallmark on clasp.', condition: 'Used - Excellent', hours: 60 },

  { title: 'Complete Emerald and Diamond Suite 18ct', category: 'jewelry', subCategory: 'Jewelry Sets', price: 5200, desc: 'Matching 18ct white gold necklace, earrings and ring set. Colombian emeralds (2.80ct total, GRS certificates) with G/VS round diamonds. Independent valuation £8,400.', condition: 'Used - Excellent', hours: 168 },
  { title: 'Colombian Emerald Loose 2.45ct GRS Certified', category: 'jewelry', subCategory: 'Loose Gemstones', price: 3600, desc: 'Colombian emerald 2.45ct, GRS certified "Minor" oil only. Vivid green colour (GRS: "vivid green"). Ideal proportions for a ring or pendant setting.', condition: 'New', hours: 168 },
];

async function seed() {
  await connectDB();

  // Find the first available user to use as seller
  const seller = await User.findOne().sort({ createdAt: 1 });
  if (!seller) {
    console.error('❌ No users found in database. Please create a user account first.');
    process.exit(1);
  }
  console.log(`✅ Using seller: ${seller.email || seller.firstName || seller._id}`);

  let created = 0;
  let skipped = 0;

  for (const item of listingsData) {
    const existingSlug = slugify(item.title);
    const exists = await Listing.findOne({ slug: existingSlug });
    if (exists) {
      skipped++;
      continue;
    }

    const startDate = new Date();
    const endDate = hoursFromNow(item.hours);
    const bidCount = randomBetween(0, 18);
    const currentPrice = item.price + (bidCount > 0 ? randomBetween(5, Math.floor(item.price * 0.15)) : 0);

    await Listing.create({
      title: item.title,
      slug: existingSlug,
      description: item.desc,
      category: item.category,
      subCategory: item.subCategory,
      images: [PLACEHOLDER_IMAGE],
      startingPrice: item.price,
      currentPrice,
      auctionFormat: 'highest-bid',
      durationSlot: item.hours <= 24 ? '24 hours' : item.hours <= 72 ? '3 days' : '7 days',
      bidCount,
      startDate,
      endDate,
      condition: item.condition,
      shippingOption: ['flat-rate', 'free', 'local-pickup'][randomBetween(0, 2)],
      shippingCost: randomBetween(0, 25),
      handlingTime: randomBetween(1, 3),
      returnPolicy: '14-days',
      listingType: randomBetween(0, 5) === 0 ? 'Promoted' : 'Standard',
      isFeatured: randomBetween(0, 8) === 0,
      isVerified: randomBetween(0, 6) === 0,
      status: 'active',
      seller: seller._id,
    });

    created++;
    process.stdout.write(`\r  Created: ${created} / ${listingsData.length}`);
  }

  console.log(`\n\n✅ Done. Created ${created} listings, skipped ${skipped} duplicates.`);
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
