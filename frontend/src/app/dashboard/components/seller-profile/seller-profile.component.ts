import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MyAuctionsComponent } from '../my-auctions/my-auctions.component';
import { CustomerService } from '../../../shared/services/customer.service';

@Component({
  selector: 'app-seller-profile',
  standalone: true,
  imports: [CommonModule, RouterLink, MyAuctionsComponent, TranslateModule],
  templateUrl: './seller-profile.component.html',
  styleUrls: ['./seller-profile.component.scss']
})
export class SellerProfileComponent implements OnInit {
  private customerService = inject(CustomerService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  sellerScore: number | null = null;
  sellerReviewCount = 0;

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const tab = params['tab'];
      if (tab === 'transactions') {
        void this.router.navigate(['/dashboard/transactions'], { replaceUrl: true });
      } else if (tab === 'disputes') {
        void this.router.navigate(['/dashboard/disputes'], { replaceUrl: true });
      } else if (tab === 'analytics') {
        void this.router.navigate(['/dashboard/home'], { replaceUrl: true });
      }
    });
    this.customerService.getCustomer().subscribe({
      next: (info) => {
        this.sellerScore = info.sellerScore ?? null;
        this.sellerReviewCount = info.sellerReviewCount ?? 0;
      }
    });
  }
}
