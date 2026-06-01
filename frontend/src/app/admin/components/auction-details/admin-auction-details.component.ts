import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminService } from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';
import { PrivateRoomService, Bidder } from '../../../private-room/services/private-room.service';
import { Listing } from '../../../shared/services/listings.service';

@Component({
  selector: 'app-admin-auction-details',
  standalone: true,
  imports: [CommonModule, AdminSidebarComponent],
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
  error: string | null = null;
  showPlatinumSelection = false;
  selectedPlatinumBidders: string[] = [];

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
        this.isLoading = false;
      },
      error: (error) => {
        this.error = error?.message || 'Failed to load auction details';
        this.isLoading = false;
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
      alert('No authenticated bidders available. Only authenticated users can be selected as Platinum Bidders.');
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
        alert('You can select a maximum of 5 Platinum Bidders.');
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
      alert('Please select at least one Platinum Bidder to create a private room.');
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

