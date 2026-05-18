import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MyBetsComponent } from '../my-bets/my-bets.component';
import { DashboardWatchlistComponent } from '../watchlist/dashboard-watchlist.component';
import { DashboardTransactionsComponent } from '../transactions/dashboard-transactions.component';
import { DashboardDisputesComponent } from '../disputes/dashboard-disputes.component';
import { CustomerService, CustomerInfo } from '../../../shared/services/customer.service';
import { TransactionsService } from '../../../shared/services/transactions.service';

type BuyerTab = 'bets' | 'watchlist' | 'transactions' | 'disputes';

@Component({
  selector: 'app-buyer-profile',
  standalone: true,
  imports: [CommonModule, MyBetsComponent, DashboardWatchlistComponent, DashboardTransactionsComponent, DashboardDisputesComponent, TranslateModule],
  templateUrl: './buyer-profile.component.html',
  styleUrls: ['./buyer-profile.component.scss']
})
export class BuyerProfileComponent implements OnInit {
  private customerService = inject(CustomerService);
  private transactionsService = inject(TransactionsService);
  private route = inject(ActivatedRoute);

  activeTab: BuyerTab = 'bets';
  customerInfo: CustomerInfo | null = null;
  pendingTransactions = 0;

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const tab = params['tab'];
      if (tab === 'transactions' || tab === 'watchlist' || tab === 'disputes' || tab === 'bets') {
        this.activeTab = tab;
      }
    });
    this.customerService.getCustomer().subscribe({
      next: (info) => this.customerInfo = info,
      error: () => {}
    });
    this.transactionsService.getPendingCounts().subscribe({
      next: (counts) => this.pendingTransactions = counts.buyer,
      error: () => {}
    });
  }

  setTab(tab: BuyerTab): void {
    this.activeTab = tab;
  }

  get buyerScore(): number | null {
    return this.customerInfo?.buyerScore ?? null;
  }

  get buyerReviewCount(): number {
    return this.customerInfo?.buyerReviewCount ?? 0;
  }

  get displayName(): string {
    if (!this.customerInfo) return '';
    const u = this.customerInfo.user;
    return `${u.firstName} ${u.lastName}`.trim();
  }
}
