import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuctionService, Auction } from '@core/services/auction.service';

@Component({
  selector: 'app-landing',
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss'],
})
export class LandingComponent implements OnInit {
  endingSoonAuctions: Auction[] = [];
  promotedAuctions: Auction[] = [];
  loading = true;

  stats = {
    totalBidders: 12543,
    valueTraded: 2547893,
    activeAuctions: 456,
  };

  constructor(
    private auctionService: AuctionService,
    private router: Router
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
      },
      error: (error) => {
        console.error('Error loading ending soon auctions:', error);
      },
    });

    // Load promoted auctions
    this.auctionService.getPromoted(5).subscribe({
      next: (auctions) => {
        this.promotedAuctions = auctions;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading promoted auctions:', error);
        this.loading = false;
      },
    });
  }

  viewAllAuctions(): void {
    this.router.navigate(['/auctions']);
  }

  viewAuction(auctionId: string): void {
    this.router.navigate(['/auctions', auctionId]);
  }
}

