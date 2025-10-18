import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MsalService } from '@azure/msal-angular';
import { AuthService } from '@core/services/auth.service';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent implements OnInit, OnDestroy {
  isAuthenticated = false;
  user: any = null;
  private destroy$ = new Subject<void>();

  constructor(
    private router: Router,
    private msalService: MsalService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    // Check initial authentication status
    this.checkAuthStatus();

    // Subscribe to authentication changes
    this.authService.isAuthenticated$.pipe(
      takeUntil(this.destroy$)
    ).subscribe(isAuth => {
      this.isAuthenticated = isAuth;
      if (isAuth) {
        this.user = this.authService.getCurrentUserSync();
      } else {
        this.user = null;
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private checkAuthStatus(): void {
    this.isAuthenticated = this.authService.isAuthenticated();
    if (this.isAuthenticated) {
      this.user = this.authService.getCurrentUserSync();
    }
  }


  navigateToRegister(): void {
    this.router.navigate(['/auth/register']);
  }

  navigateToSell(): void {
    this.router.navigate(['/auctions/create']);
  }

  navigateToLogin(): void {
    this.router.navigate(['/auth/login']);
  }

  logout(): void {
    this.authService.logout();
  }

  navigateToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }
}
