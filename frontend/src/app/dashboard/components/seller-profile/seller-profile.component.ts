import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MyAuctionsComponent } from '../my-auctions/my-auctions.component';
import { SellerAnalyticsComponent } from '../seller-analytics/seller-analytics.component';
import { DashboardTransactionsComponent } from '../transactions/dashboard-transactions.component';
import { DashboardDisputesComponent } from '../disputes/dashboard-disputes.component';
import { CustomerService } from '../../../shared/services/customer.service';
import { TransactionsService } from '../../../shared/services/transactions.service';

type SellerTab = 'auctions' | 'analytics' | 'transactions' | 'disputes';

@Component({
  selector: 'app-seller-profile',
  standalone: true,
  imports: [CommonModule, MyAuctionsComponent, SellerAnalyticsComponent, DashboardTransactionsComponent, DashboardDisputesComponent, TranslateModule],
  templateUrl: './seller-profile.component.html',
  styleUrls: ['./seller-profile.component.scss']
})
export class SellerProfileComponent implements OnInit {
  private customerService = inject(CustomerService);
  private transactionsService = inject(TransactionsService);
  private route = inject(ActivatedRoute);

  activeTab: SellerTab = 'auctions';
  sellerScore: number | null = null;
  sellerReviewCount = 0;
  pendingTransactions = 0;

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const tab = params['tab'];
      if (tab === 'transactions' || tab === 'disputes' || tab === 'auctions' || tab === 'analytics') {
        this.activeTab = tab;
      }
    });
    this.customerService.getCustomer().subscribe({
      next: (info) => {
        this.sellerScore = info.sellerScore ?? null;
        this.sellerReviewCount = info.sellerReviewCount ?? 0;
      }
    });
    this.transactionsService.getPendingCounts().subscribe({
      next: (counts) => this.pendingTransactions = counts.seller,
      error: () => {}
    });
  }

  setTab(tab: SellerTab): void {
    this.activeTab = tab;
  }
}
