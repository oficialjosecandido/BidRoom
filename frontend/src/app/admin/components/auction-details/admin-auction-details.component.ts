import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminService } from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';
import { PrivateRoomService, Bidder } from '../../../private-room/services/private-room.service';
import { Listing } from '../../../shared/services/listings.service';

const NEXUS_CATEGORIES: { id: string; name: string; subCategories: string[] }[] = [
  {
    id: 'electronics',
    name: 'Electronics',
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
    subCategories: ['Paintings', 'Drawings', 'Prints', 'Photography', 'Sculptures', 'Figurines', 'Other Art']
  },
  {
    id: 'collectibles',
    name: 'Collectibles',
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
    subCategories: [
      'Engagement Rings', 'Wedding Rings', 'Fashion Rings',
      'Chains', 'Pendants',
      'Bangles', 'Charm Bracelets',
      'Stud Earrings', 'Hoop Earrings', 'Drop Earrings',
      'Luxury Watches', 'Vintage Watches', 'Smart Watches',
      'Brooches & Pins', 'Jewelry Sets', 'Loose Gemstones', 'Other Jewelry'
    ]
  },
  {
    id: 'vehicles',
    name: 'Vehicles',
    subCategories: [
      'Cars', 'Classic Cars', 'Electric & Hybrid Cars',
      'Motorcycles', 'Scooters & Mopeds',
      'Vans & Minibuses', 'Trucks & HGV',
      'Boats', 'Jet Skis & Watercraft', 'Sailboats',
      'Caravans & Motorhomes', 'ATVs & Quad Bikes',
      'Vehicle Parts', 'Vehicle Accessories', 'Other Vehicles'
    ]
  },
  {
    id: 'real-estate',
    name: 'Real Estate',
    subCategories: ['Apartments', 'Houses', 'Land', 'Commercial', 'Other Real Estate']
  }
];

@Component({
  selector: 'app-admin-auction-details',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminSidebarComponent],
  templateUrl: './admin-auction-details.component.html',
  styleUrls: ['./admin-auction-details.component.scss']
})
export class AdminAuctionDetailsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private adminService = inject(AdminService);
  private privateRoomService = inject(PrivateRoomService);

  auctionId = '';
  auction: Listing | null = null;
  bidders: Bidder[] = [];
  isLoading = false;
  isCreatingPrivateRoom = false;
  isClosingPrivateRoom = false;
  isDeleting = false;
  isSavingCategory = false;
  error: string | null = null;
  showPlatinumSelection = false;
  selectedPlatinumBidders: string[] = [];

  readonly categories = NEXUS_CATEGORIES;
  editCategory = '';
  editSubCategory = '';
  categorySavedMsg: string | null = null;
  editEndDate = '';
  isSavingEndDate = false;
  endDateSavedMsg: string | null = null;

  get editSubCategories(): string[] {
    return this.categories.find(c => c.id === this.editCategory)?.subCategories ?? [];
  }

  ngOnInit(): void {
    this.auctionId = this.route.snapshot.paramMap.get('id') || '';
    if (this.auctionId) {
      this.loadAuctionDetails();
      this.loadBidders();
    }
  }

  loadAuctionDetails(): void {
    this.isLoading = true;
    this.error = null;

    this.adminService.getAuctionById(this.auctionId).subscribe({
      next: (auction) => {
        this.auction = auction;
        this.editCategory = auction.category || 'jewelry';
        this.editSubCategory = auction.subCategory || '';
        this.editEndDate = this.toDatetimeLocal(auction.endDate);
        this.isLoading = false;
      },
      error: (error) => {
        this.error = error?.message || 'Failed to load auction details';
        this.isLoading = false;
      }
    });
  }

  onCategoryChange(): void {
    const subs = this.editSubCategories;
    if (!subs.includes(this.editSubCategory)) {
      this.editSubCategory = subs[0] || '';
    }
  }

  saveCategory(): void {
    if (!this.auction || !this.editCategory || !this.editSubCategory || this.isSavingCategory) return;
    this.isSavingCategory = true;
    this.categorySavedMsg = null;
    this.adminService.updateListingCategory(this.auctionId, {
      category: this.editCategory,
      subCategory: this.editSubCategory
    }).subscribe({
      next: (res) => {
        if (this.auction) {
          this.auction.category = res.category;
          this.auction.subCategory = res.subCategory;
        }
        this.isSavingCategory = false;
        this.categorySavedMsg = 'Category updated';
        setTimeout(() => { this.categorySavedMsg = null; }, 2500);
      },
      error: (err) => {
        this.isSavingCategory = false;
        alert(err?.error?.message || err?.error?.error || 'Failed to update category.');
      }
    });
  }

  private toDatetimeLocal(dateStr: string | undefined): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  saveEndDate(): void {
    if (!this.auction || !this.editEndDate || this.isSavingEndDate) return;
    const newEnd = new Date(this.editEndDate);
    if (isNaN(newEnd.getTime())) { alert('Invalid date'); return; }
    this.isSavingEndDate = true;
    this.endDateSavedMsg = null;
    this.adminService.updateListingEndDate(this.auctionId, newEnd.toISOString()).subscribe({
      next: (res) => {
        if (this.auction) {
          (this.auction as any).endDate = res.endDate;
        }
        this.isSavingEndDate = false;
        this.endDateSavedMsg = 'End date updated';
        setTimeout(() => { this.endDateSavedMsg = null; }, 2500);
      },
      error: (err) => {
        this.isSavingEndDate = false;
        alert(err?.error?.message || err?.error?.error || 'Failed to update end date.');
      }
    });
  }

  loadBidders(): void {
    this.privateRoomService.getBidders(this.auctionId).subscribe({
      next: (response) => {
        this.bidders = response.bidders;
      },
      error: (error) => {
        console.error('Failed to load bidders:', error);
      }
    });
  }

  openPlatinumSelection(): void {
    // Filter to only authenticated bidders (required for platinum)
    const authenticatedBidders = this.bidders.filter(b => b.isAuthenticated && b._id);
    if (authenticatedBidders.length === 0) {
      alert('No authenticated bidders available. Only registered users can be selected.');
      return;
    }
    this.showPlatinumSelection = true;
    // Pre-select already selected platinum bidders
    if (this.auction?.platinumBidders) {
      this.selectedPlatinumBidders = this.auction.platinumBidders
        .map((pb: any) => typeof pb === 'string' ? pb : pb._id)
        .filter((id: string) => authenticatedBidders.some(b => b._id === id));
    }
  }

  closePlatinumSelection(): void {
    this.showPlatinumSelection = false;
    this.selectedPlatinumBidders = [];
  }

  togglePlatinumBidder(bidderId: string | undefined): void {
    if (!bidderId) return;
    
    const index = this.selectedPlatinumBidders.indexOf(bidderId);
    if (index > -1) {
      this.selectedPlatinumBidders.splice(index, 1);
    } else {
      if (this.selectedPlatinumBidders.length >= 5) {
        alert('You can select a maximum of 5 bidders.');
        return;
      }
      this.selectedPlatinumBidders.push(bidderId);
    }
  }

  isPlatinumSelected(bidderId: string | undefined): boolean {
    if (!bidderId) return false;
    return this.selectedPlatinumBidders.includes(bidderId);
  }

  createPrivateRoom(): void {
    if (!this.auction) return;

    if (this.selectedPlatinumBidders.length === 0) {
      alert('Please select at least one bidder to create a private room.');
      return;
    }

    this.isCreatingPrivateRoom = true;
    this.error = null;

    this.adminService.createPrivateRoom(this.auctionId, this.selectedPlatinumBidders).subscribe({
      next: () => {
        this.isCreatingPrivateRoom = false;
        this.showPlatinumSelection = false;
        this.selectedPlatinumBidders = [];
        this.loadAuctionDetails(); // Reload to get updated data
        this.loadBidders(); // Reload bidders to see updated status
      },
      error: (error) => {
        this.error = error?.message || 'Failed to create private auction room';
        this.isCreatingPrivateRoom = false;
      }
    });
  }

  getAuctionTypeLabel(format: string): string {
    return format === 'highest-bid' ? 'Highest Bid Auction' : 'Best Offer';
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getBidderName(bidder: Bidder): string {
    if (bidder.isAuthenticated && bidder.firstName && bidder.lastName) {
      return `${bidder.firstName} ${bidder.lastName}`;
    }
    return bidder.email;
  }

  getAuthenticatedBidders(): Bidder[] {
    return this.bidders.filter(b => b.isAuthenticated && b._id);
  }

  isPlatinumBidder(bidderId: string | undefined): boolean {
    if (!bidderId || !this.auction?.platinumBidders) {
      return false;
    }
    // platinumBidders can be array of strings (IDs) or array of objects (populated)
    return this.auction.platinumBidders.some((pb: any) => {
      if (typeof pb === 'string') {
        return pb === bidderId;
      }
      return pb._id === bidderId || pb === bidderId;
    });
  }

  closePrivateRoomAndEndAuction(): void {
    if (!this.auction) return;

    if (!confirm('Are you sure you want to close the private room and end this auction? This action cannot be undone.')) {
      return;
    }

    this.isClosingPrivateRoom = true;
    this.error = null;

    this.adminService.closePrivateRoomAndEndAuction(this.auctionId).subscribe({
      next: () => {
        this.isClosingPrivateRoom = false;
        this.loadAuctionDetails(); // Reload to get updated data
        this.loadBidders(); // Reload bidders to see updated status
      },
      error: (error) => {
        this.error = error?.message || 'Failed to close private room and end auction';
        this.isClosingPrivateRoom = false;
      }
    });
  }

  bidderTrackKey(bidder: Bidder): string {
    return bidder._id != null ? String(bidder._id) : bidder.email;
  }

  deleteListing(): void {
    if (!this.auction || this.isDeleting) return;
    if (!confirm(`Delete "${this.auction.title}"? This permanently removes the listing and all its bids. Active transactions will block deletion.`)) return;
    this.isDeleting = true;
    this.adminService.deleteListing(this.auctionId).subscribe({
      next: () => {
        this.router.navigate(['/nexus/auctions']);
      },
      error: (err) => {
        this.isDeleting = false;
        alert(err?.error?.message || 'Failed to delete listing.');
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/nexus/auctions']);
  }
}

