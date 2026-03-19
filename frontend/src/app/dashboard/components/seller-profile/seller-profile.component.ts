import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MyAuctionsComponent } from '../my-auctions/my-auctions.component';
import { DashboardTransactionsComponent } from '../transactions/dashboard-transactions.component';
import { DashboardDisputesComponent } from '../disputes/dashboard-disputes.component';
import { CustomerService } from '../../../shared/services/customer.service';

type SellerTab = 'auctions' | 'transactions' | 'disputes';

@Component({
  selector: 'app-seller-profile',
  standalone: true,
  imports: [CommonModule, MyAuctionsComponent, DashboardTransactionsComponent, DashboardDisputesComponent, TranslateModule],
  templateUrl: './seller-profile.component.html',
  styleUrls: ['./seller-profile.component.scss']
})
export class SellerProfileComponent implements OnInit {
  private customerService = inject(CustomerService);
  private route = inject(ActivatedRoute);

  activeTab: SellerTab = 'auctions';
  sellerScore: number | null = null;
  sellerReviewCount = 0;

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const tab = params['tab'];
      if (tab === 'transactions' || tab === 'disputes' || tab === 'auctions') {
        this.activeTab = tab;
      }
    });
    this.customerService.getCustomer().subscribe({
      next: (info) => {
        this.sellerScore = info.sellerScore ?? null;
        this.sellerReviewCount = info.sellerReviewCount ?? 0;
      }
    });
  }

  setTab(tab: SellerTab): void {
    this.activeTab = tab;
  }
}
