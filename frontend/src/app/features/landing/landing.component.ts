import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { AuctionService, Auction } from '@core/services/auction.service';
import { Logger } from '@core/services/logger.service';
import { AuthService } from '@core/services/auth.service';

@Component({
  selector: 'app-landing',
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LandingComponent implements OnInit {
  endingSoonAuctions: Auction[] = [];
  promotedAuctions: Auction[] = [];
  allAuctions: Auction[] = [];
  filteredAuctions: Auction[] = [];
  featuredAuctions: Auction[] = [];
  loading = true;
  searchQuery = '';
  
  // Filter properties
  selectedCategory = '';
  sortBy = 'deadline';
  minPrice = 0;
  maxPrice = 50000;
  minBids = 0;
  showFeatured = false;
  showVerified = false;
  showBuyNow = false;
  
  // View properties
  viewMode: 'grid' | 'list' = 'grid';
  hasMoreAuctions = true;
  currentPage = 1;
  itemsPerPage = 12;
  
  // Platform stats
  platformStats = {
    totalBidders: 12543,
    valueTraded: 2547893,
    activeAuctions: 456,
    verifiedListings: 234
  };
  
  // Modal state
  showWatchlistModal = false;
  selectedAuction: Auction | null = null;

  constructor(
    private auctionService: AuctionService,
    private router: Router,
    private logger: Logger,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadAuctions();
  }

  loadAuctions(): void {
    this.loading = true;

    // Load ending soon auctions
    this.auctionService.getEndingSoon(8).subscribe({
      next: (auctions) => {
        this.endingSoonAuctions = auctions;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.logger.error('Error loading ending soon auctions:', error);
        // Fallback to mock data
        this.endingSoonAuctions = this.getMockEndingSoonAuctions();
        this.cdr.markForCheck();
      },
    });

    // Load promoted auctions
    this.auctionService.getPromoted(5).subscribe({
      next: (auctions) => {
        this.promotedAuctions = auctions;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.logger.error('Error loading promoted auctions:', error);
        // Fallback to mock data
        this.promotedAuctions = this.getMockPromotedAuctions();
        this.cdr.markForCheck();
      },
    });

    // Load all auctions for additional listings
    this.auctionService.getAllAuctions().subscribe({
      next: (auctions) => {
        this.allAuctions = auctions;
        this.featuredAuctions = auctions.filter(auction => auction.isPromoted);
        this.applyFilters();
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.logger.error('Error loading auctions:', error);
        // Fallback to mock data
        this.allAuctions = this.getMockAllAuctions();
        this.featuredAuctions = this.allAuctions.filter(auction => auction.isPromoted);
        this.applyFilters();
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private getMockEndingSoonAuctions(): Auction[] {
    return [
      {
        _id: '1',
        sellerId: 'seller1',
        title: 'Vintage Camera',
        description: 'Beautiful vintage camera in excellent condition',
        category: 'Photography',
        tags: ['camera', 'vintage', 'photography'],
        images: [{ url: 'https://images.unsplash.com/photo-1606983340126-99ab4feaa64a?w=400', alt: 'Vintage Camera', isPrimary: true }],
        format: 'highest_bid' as const,
        duration: '2h' as const,
        startingBid: 100,
        currentBid: 1250,
        minBidIncrement: 10,
        allowPrivateRoom: true,
        status: 'active' as const,
        startTime: new Date(),
        endTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        totalBids: 15,
        uniqueBidders: 8,
        viewCount: 120,
        watcherCount: 25,
        isVerified: true,
        isPromoted: false,
        buyNowPrice: 1500
      },
      {
        _id: '2',
        sellerId: 'seller2',
        title: 'Designer Sneakers',
        description: 'Limited edition designer sneakers',
        category: 'Fashion',
        tags: ['sneakers', 'designer', 'fashion'],
        images: [{ url: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=400', alt: 'Designer Sneakers', isPrimary: true }],
        format: 'highest_bid' as const,
        duration: '2h' as const,
        startingBid: 200,
        currentBid: 1480,
        minBidIncrement: 20,
        allowPrivateRoom: true,
        status: 'active' as const,
        startTime: new Date(),
        endTime: new Date(Date.now() + 1.5 * 60 * 60 * 1000),
        totalBids: 22,
        uniqueBidders: 12,
        viewCount: 180,
        watcherCount: 35,
        isVerified: true,
        isPromoted: true,
        buyNowPrice: 1800
      },
      {
        _id: '3',
        sellerId: 'seller3',
        title: 'Diamond Ring',
        description: 'Elegant diamond engagement ring',
        category: 'Jewelry',
        tags: ['diamond', 'ring', 'jewelry'],
        images: [{ url: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=400', alt: 'Diamond Ring', isPrimary: true }],
        format: 'highest_bid' as const,
        duration: '2h' as const,
        startingBid: 500,
        currentBid: 1580,
        minBidIncrement: 50,
        allowPrivateRoom: true,
        status: 'active' as const,
        startTime: new Date(),
        endTime: new Date(Date.now() + 1.3 * 60 * 60 * 1000),
        totalBids: 18,
        uniqueBidders: 9,
        viewCount: 95,
        watcherCount: 20,
        isVerified: true,
        isPromoted: false
      }
    ];
  }

  private getMockPromotedAuctions(): Auction[] {
    return [
      {
        _id: '4',
        sellerId: 'seller4',
        title: 'Comic Book Collection',
        description: 'Rare comic book collection',
        category: 'Collectibles',
        tags: ['comics', 'collectibles', 'rare'],
        images: [{ url: 'https://images.unsplash.com/photo-1612198188060-c7c2a3b66eae?w=400', alt: 'Comic Book', isPrimary: true }],
        format: 'highest_bid' as const,
        duration: '7d' as const,
        startingBid: 1000,
        currentBid: 15532,
        minBidIncrement: 100,
        allowPrivateRoom: true,
        status: 'active' as const,
        startTime: new Date(),
        endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        totalBids: 45,
        uniqueBidders: 25,
        viewCount: 350,
        watcherCount: 80,
        isVerified: true,
        isPromoted: true
      },
      {
        _id: '5',
        sellerId: 'seller5',
        title: 'Vintage Guitar',
        description: 'Beautiful vintage acoustic guitar',
        category: 'Musical Instruments',
        tags: ['guitar', 'vintage', 'music'],
        images: [{ url: 'https://images.unsplash.com/photo-1516924962500-2b4b3b99ea02?w=400', alt: 'Vintage Guitar', isPrimary: true }],
        format: 'highest_bid' as const,
        duration: '7d' as const,
        startingBid: 800,
        currentBid: 12500,
        minBidIncrement: 50,
        allowPrivateRoom: true,
        status: 'active' as const,
        startTime: new Date(),
        endTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        totalBids: 38,
        uniqueBidders: 20,
        viewCount: 280,
        watcherCount: 65,
        isVerified: true,
        isPromoted: true
      },
      {
        _id: '6',
        sellerId: 'seller6',
        title: 'Sports Jersey',
        description: 'Authentic sports jersey with number 19',
        category: 'Sports',
        tags: ['jersey', 'sports', 'authentic'],
        images: [{ url: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400', alt: 'Sports Jersey', isPrimary: true }],
        format: 'highest_bid' as const,
        duration: '7d' as const,
        startingBid: 200,
        currentBid: 15080,
        minBidIncrement: 25,
        allowPrivateRoom: true,
        status: 'active' as const,
        startTime: new Date(),
        endTime: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
        totalBids: 52,
        uniqueBidders: 28,
        viewCount: 420,
        watcherCount: 95,
        isVerified: true,
        isPromoted: true
      }
    ];
  }

  private getMockAllAuctions(): Auction[] {
    const allAuctions = [
      ...this.getMockEndingSoonAuctions(),
      ...this.getMockPromotedAuctions(),
      {
        _id: '7',
        sellerId: 'seller7',
        title: 'Art Supplies Set',
        description: 'Professional art supplies collection',
        category: 'Art',
        tags: ['art', 'supplies', 'professional'],
        images: [{ url: 'https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=400', alt: 'Art Supplies', isPrimary: true }],
        format: 'highest_bid' as const,
        duration: '3d' as const,
        startingBid: 150,
        currentBid: 13990,
        minBidIncrement: 20,
        allowPrivateRoom: true,
        status: 'active' as const,
        startTime: new Date(),
        endTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        totalBids: 28,
        uniqueBidders: 15,
        viewCount: 180,
        watcherCount: 40,
        isVerified: true,
        isPromoted: false
      },
      {
        _id: '8',
        sellerId: 'seller8',
        title: 'Luxury Watch',
        description: 'High-end luxury timepiece',
        category: 'Watches',
        tags: ['watch', 'luxury', 'timepiece'],
        images: [{ url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400', alt: 'Luxury Watch', isPrimary: true }],
        format: 'highest_bid' as const,
        duration: '7d' as const,
        startingBid: 2000,
        currentBid: 12110,
        minBidIncrement: 100,
        allowPrivateRoom: true,
        status: 'active' as const,
        startTime: new Date(),
        endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        totalBids: 35,
        uniqueBidders: 18,
        viewCount: 250,
        watcherCount: 55,
        isVerified: true,
        isPromoted: false
      },
      {
        _id: '9',
        sellerId: 'seller9',
        title: 'Oil Painting',
        description: 'Original oil painting artwork',
        category: 'Art',
        tags: ['painting', 'oil', 'artwork'],
        images: [{ url: 'https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=400', alt: 'Oil Painting', isPrimary: true }],
        format: 'highest_bid' as const,
        duration: '7d' as const,
        startingBid: 300,
        currentBid: 13500,
        minBidIncrement: 50,
        allowPrivateRoom: true,
        status: 'active' as const,
        startTime: new Date(),
        endTime: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000),
        totalBids: 42,
        uniqueBidders: 22,
        viewCount: 320,
        watcherCount: 75,
        isVerified: true,
        isPromoted: false
      }
    ];
    return allAuctions;
  }

  getTimeRemaining(auction: Auction): string {
    // Calculate actual time remaining based on auction end time
    const now = new Date();
    const endTime = new Date(auction.endTime);
    const timeDiff = endTime.getTime() - now.getTime();
    
    if (timeDiff <= 0) {
      return 'Ended';
    }
    
    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  // Navigation methods
  startBidding(): void {
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/auctions']);
    } else {
      this.router.navigate(['/auth/register']);
    }
  }

  startSelling(): void {
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/auctions/create']);
    } else {
      this.router.navigate(['/auth/register']);
    }
  }

  viewAllAuctions(): void {
    this.router.navigate(['/auctions']);
  }

  viewAuction(auctionId: string): void {
    this.router.navigate(['/auctions', auctionId]);
  }

  viewEndingSoon(): void {
    this.router.navigate(['/auctions'], { queryParams: { sort: 'deadline' } });
  }

  // Search functionality
  performSearch(): void {
    this.applyFilters();
  }

  // Filter and sort functionality
  applyFilters(): void {
    let filtered = [...this.allAuctions];

    // Search filter
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(auction => 
        auction.title.toLowerCase().includes(query) ||
        auction.description.toLowerCase().includes(query) ||
        auction.category.toLowerCase().includes(query)
      );
    }

    // Category filter
    if (this.selectedCategory) {
      filtered = filtered.filter(auction => auction.category === this.selectedCategory);
    }

    // Price range filter
    filtered = filtered.filter(auction => 
      auction.currentBid >= this.minPrice && auction.currentBid <= this.maxPrice
    );

    // Minimum bids filter
    if (this.minBids > 0) {
      filtered = filtered.filter(auction => auction.totalBids >= this.minBids);
    }

    // Listing type filters
    if (this.showFeatured) {
      filtered = filtered.filter(auction => auction.isPromoted);
    }

    if (this.showVerified) {
      filtered = filtered.filter(auction => auction.isVerified);
    }

    if (this.showBuyNow) {
      filtered = filtered.filter(auction => auction.buyNowPrice);
    }

    // Sort auctions
    filtered = this.sortAuctions(filtered, this.sortBy);

    this.filteredAuctions = filtered;
    this.hasMoreAuctions = this.filteredAuctions.length > this.itemsPerPage;
    this.cdr.markForCheck();
  }

  sortAuctions(auctions: Auction[], sortBy: string): Auction[] {
    return auctions.sort((a, b) => {
      switch (sortBy) {
        case 'deadline':
          return new Date(a.endTime).getTime() - new Date(b.endTime).getTime();
        case 'newest':
          return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
        case 'highest_price':
          return b.currentBid - a.currentBid;
        case 'lowest_price':
          return a.currentBid - b.currentBid;
        case 'most_bids':
          return b.totalBids - a.totalBids;
        default:
          return 0;
      }
    });
  }

  clearFilters(): void {
    this.selectedCategory = '';
    this.sortBy = 'deadline';
    this.minPrice = 0;
    this.maxPrice = 50000;
    this.minBids = 0;
    this.showFeatured = false;
    this.showVerified = false;
    this.showBuyNow = false;
    this.searchQuery = '';
    this.applyFilters();
  }

  updatePriceRange(): void {
    this.applyFilters();
  }

  // View mode functionality
  setViewMode(mode: 'grid' | 'list'): void {
    this.viewMode = mode;
  }

  // Load more functionality
  loadMoreAuctions(): void {
    this.currentPage++;
    // In a real app, you would load more data from the API
    // For now, we'll just show more items from the existing data
    this.itemsPerPage += 12;
    this.hasMoreAuctions = this.filteredAuctions.length > this.itemsPerPage;
  }

  // Watchlist functionality
  toggleWatchlist(auction: Auction, event: Event): void {
    event.stopPropagation();
    
    if (this.authService.isAuthenticated()) {
      // User is logged in, add to watchlist
      this.addToWatchlist(auction);
    } else {
      // User is not logged in, show modal
      this.selectedAuction = auction;
      this.showWatchlistModal = true;
    }
  }

  addToWatchlist(auction: Auction): void {
    // Implement watchlist service call
    this.logger.info('Adding auction to watchlist:', auction._id);
    // Show success message
  }

  closeWatchlistModal(): void {
    this.showWatchlistModal = false;
    this.selectedAuction = null;
  }

  signUpForWatchlist(): void {
    this.closeWatchlistModal();
    this.router.navigate(['/auth/register'], { 
      queryParams: { returnUrl: '/auctions' } 
    });
  }
}

