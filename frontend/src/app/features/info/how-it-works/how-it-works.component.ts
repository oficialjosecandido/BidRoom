import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@core/services/auth.service';

@Component({
  selector: 'app-how-it-works',
  templateUrl: './how-it-works.component.html',
  styleUrls: ['./how-it-works.component.scss']
})
export class HowItWorksComponent {

  constructor(
    private router: Router,
    private authService: AuthService
  ) {}

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
}
