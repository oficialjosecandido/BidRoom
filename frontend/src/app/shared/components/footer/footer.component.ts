import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@core/services/auth.service';

@Component({
  selector: 'app-footer',
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss']
})
export class FooterComponent {

  constructor(
    private router: Router,
    private authService: AuthService
  ) {}

  startSelling(): void {
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/auctions/create']);
    } else {
      this.router.navigate(['/auth/register']);
    }
  }
}
