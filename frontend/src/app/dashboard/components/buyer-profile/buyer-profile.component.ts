import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { DashboardWatchlistComponent } from '../watchlist/dashboard-watchlist.component';

@Component({
  selector: 'app-buyer-profile',
  standalone: true,
  imports: [DashboardWatchlistComponent],
  templateUrl: './buyer-profile.component.html',
  styleUrls: ['./buyer-profile.component.scss']
})
export class BuyerProfileComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const tab = params['tab'];
      if (tab === 'transactions') {
        void this.router.navigate(['/dashboard/transactions'], { replaceUrl: true });
        return;
      }
      if (tab === 'bets') {
        void this.router.navigate(['/dashboard/my-bets'], { replaceUrl: true });
        return;
      }
      if (tab === 'disputes') {
        void this.router.navigate(['/dashboard/disputes'], { replaceUrl: true });
        return;
      }
      if (tab === 'watchlist') {
        void this.router.navigate(['/dashboard/buyer'], { replaceUrl: true });
      }
    });
  }
}
