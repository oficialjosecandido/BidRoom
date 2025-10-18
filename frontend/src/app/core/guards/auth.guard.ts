import { Injectable } from '@angular/core';
import { CanActivate, CanActivateChild, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Observable, from } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { MsalService } from '@azure/msal-angular';
import { InteractionType } from '@azure/msal-browser';
import { AuthService } from '../services/auth.service';
import { Logger } from '../services/logger.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate, CanActivateChild {
  constructor(
    private msalService: MsalService,
    private authService: AuthService,
    private router: Router,
    private logger: Logger
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> | Promise<boolean> | boolean {
    return this.checkAuth(state.url);
  }

  canActivateChild(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> | Promise<boolean> | boolean {
    return this.checkAuth(state.url);
  }

  private checkAuth(url: string): Observable<boolean> | Promise<boolean> | boolean {
    const accounts = this.msalService.instance.getAllAccounts();
    
    if (accounts.length === 0) {
      this.logger.info('No active accounts found, redirecting to login');
      this.redirectToLogin(url);
      return false;
    }

    const account = accounts[0];
    this.msalService.instance.setActiveAccount(account);

    // Check if user is authenticated
    if (this.authService.isAuthenticated()) {
      return true;
    }

    // Try to get access token silently
    return from(this.msalService.acquireTokenSilent({
      scopes: ['openid', 'profile', 'email'],
      account: account
    })).pipe(
      map((response) => {
        if (response && response.accessToken) {
          this.logger.info('Access token acquired successfully');
          return true;
        }
        this.redirectToLogin(url);
        return false;
      }),
      catchError((error) => {
        this.logger.error('Failed to acquire token silently:', error);
        this.redirectToLogin(url);
        return from([false]);
      })
    );
  }

  private redirectToLogin(url: string): void {
    // Store the URL to redirect to after login
    sessionStorage.setItem('redirectUrl', url);
    
    // Redirect to login
    this.msalService.loginRedirect({
      scopes: ['openid', 'profile', 'email'],
      prompt: 'select_account'
    });
  }
}

@Injectable({
  providedIn: 'root'
})
export class BiddingAuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router,
    private logger: Logger
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> | Promise<boolean> | boolean {
    if (!this.authService.isAuthenticated()) {
      this.logger.warn('User not authenticated, redirecting to login');
      this.router.navigate(['/auth/login']);
      return false;
    }

    // Check if user has bidding privileges
    return this.authService.getCurrentUser().pipe(
      map((user) => {
        if (!user) {
          this.logger.warn('No user data available');
          return false;
        }

        const canBid = user.biddingStatus.isActive && 
                      (user.biddingStatus.tier === 'verified' || user.biddingStatus.tier === 'premium');

        if (!canBid) {
          this.logger.warn('User does not have bidding privileges', user.biddingStatus);
          this.router.navigate(['/auth/verify-bidding']);
          return false;
        }

        return true;
      }),
      catchError((error) => {
        this.logger.error('Error checking bidding privileges:', error);
        this.router.navigate(['/auth/login']);
        return from([false]);
      })
    );
  }
}
