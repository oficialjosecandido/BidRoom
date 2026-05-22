import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PrivateRoomService, Bidder } from '../../services/private-room.service';

@Component({
  selector: 'app-platinum-bidders',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  templateUrl: './platinum-bidders.component.html',
  styleUrls: ['./platinum-bidders.component.scss']
})
export class PlatinumBiddersComponent implements OnInit {
  private route = inject(ActivatedRoute);
  router = inject(Router);
  private privateRoomService = inject(PrivateRoomService);
  private translate = inject(TranslateService);

  listingId = '';
  bidders: Bidder[] = [];
  selectedBidderIds: string[] = [];
  currentPlatinumBidders: string[] = [];
  isLoading = false;
  isSaving = false;
  error: string | null = null;
  successMessage: string | null = null;

  navigateToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  ngOnInit(): void {
    this.listingId = this.route.snapshot.paramMap.get('id') || '';
    if (this.listingId) {
      this.loadBidders();
    }
  }

  loadBidders(): void {
    this.isLoading = true;
    this.error = null;

    this.privateRoomService.getBidders(this.listingId).subscribe({
      next: (response) => {
        this.bidders = response.bidders;
        this.currentPlatinumBidders = response.currentPlatinumBidders || [];
        this.selectedBidderIds = [...this.currentPlatinumBidders];
        this.isLoading = false;
      },
      error: (error) => {
        this.error = error?.message || this.translate.instant('listing.platinumBidders.errorLoading');
        this.isLoading = false;
      }
    });
  }

  isSelected(bidderId: string): boolean {
    return this.selectedBidderIds.includes(bidderId);
  }

  toggleBidder(bidderId: string): void {
    if (!bidderId) return; // Skip unauthenticated bidders for now

    const index = this.selectedBidderIds.indexOf(bidderId);
    if (index > -1) {
      this.selectedBidderIds.splice(index, 1);
    } else {
      if (this.selectedBidderIds.length >= 5) {
        alert(this.translate.instant('listing.platinumBidders.maxAlert'));
        return;
      }
      this.selectedBidderIds.push(bidderId);
    }
  }

  canSelect(): boolean {
    return this.selectedBidderIds.length > 0 && this.selectedBidderIds.length <= 5;
  }

  saveSelection(): void {
    if (!this.canSelect()) {
      return;
    }

    this.isSaving = true;
    this.error = null;
    this.successMessage = null;

    this.privateRoomService.selectPlatinumBidders(this.listingId, this.selectedBidderIds).subscribe({
      next: (response) => {
        this.successMessage = response.message || 'Platinum Bidders selected successfully!';
        this.currentPlatinumBidders = response.platinumBidders;
        this.isSaving = false;
        
        // Reload bidders to get updated data
        setTimeout(() => {
          this.loadBidders();
        }, 1000);
      },
      error: (error) => {
        this.error = error?.message || this.translate.instant('listing.platinumBidders.errorSaving');
        this.isSaving = false;
      }
    });
  }

  getBidderName(bidder: Bidder): string {
    if (bidder.isAuthenticated && bidder.firstName && bidder.lastName) {
      return `${bidder.firstName} ${bidder.lastName}`;
    }
    return bidder.email;
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

