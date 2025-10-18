import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, throwError, from } from 'rxjs';
import { catchError, map, tap, switchMap } from 'rxjs/operators';
import { MsalService } from '@azure/msal-angular';
import { AuthenticationResult, AccountInfo } from '@azure/msal-browser';
import { environment } from '@environments/environment';
import { Logger } from './logger.service';

export interface User {
  _id: string;
  azureObjectId: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  phone?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  role: 'user' | 'admin' | 'moderator';
  isVerified: boolean;
  isEmailConfirmed: boolean;
  biddingStatus: {
    tier: 'basic' | 'verified' | 'premium';
    isActive: boolean;
    preAuthAmount?: number;
    preAuthExpiry?: Date;
    stripeCustomerId?: string;
  };
  reputation: {
    score: number;
    totalBids: number;
    totalWins: number;
    totalSales: number;
    positiveReviews: number;
    negativeReviews: number;
  };
  createdAt: Date;
  lastLoginAt: Date;
}

export interface AuthResponse {
  user: User;
  token: string;
  refreshToken: string;
}

export interface PreAuthRequest {
  amount: number;
  currency: string;
  auctionId?: string;
}

export interface PreAuthResponse {
  clientSecret: string;
  preAuthId: string;
  amount: number;
  status: 'pending' | 'succeeded' | 'failed';
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private apiUrl = environment.apiUrl;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  private tokenSubject = new BehaviorSubject<string | null>(null);
  private refreshTokenSubject = new BehaviorSubject<string | null>(null);
  private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);

  public currentUser$ = this.currentUserSubject.asObservable();
  public token$ = this.tokenSubject.asObservable();
  public isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  constructor(
    private http: HttpClient,
    private msalService: MsalService,
    private logger: Logger
  ) {
    // Don't initialize immediately - wait for app component to initialize MSAL first
  }

  // Public method to initialize auth after MSAL is ready
  initialize(): void {
    this.initializeAuth();
  }

  private initializeAuth(): void {
    // Wait for MSAL to be fully initialized before checking accounts
    setTimeout(() => {
      this.msalService.instance.handleRedirectPromise().then((response) => {
        if (response) {
          this.handleAuthSuccess(response);
        } else {
          // Check if there's an active account
          const accounts = this.msalService.instance.getAllAccounts();
          if (accounts.length > 0) {
            this.msalService.instance.setActiveAccount(accounts[0]);
            this.setUserFromAccount(accounts[0]);
          }
        }
      }).catch((error) => {
        this.logger.error('MSAL initialization error:', error);
      });
    }, 100);
  }

  // Azure AD B2C Authentication Methods
  loginWithPopup(): Observable<AuthenticationResult> {
    return from(this.msalService.loginPopup({
      scopes: ['openid', 'profile', 'email'],
      prompt: 'select_account'
    })).pipe(
      tap((response) => this.handleAuthSuccess(response)),
      catchError((error) => {
        this.logger.error('Popup login failed:', error);
        return throwError(() => error);
      })
    );
  }

  loginWithRedirect(): void {
    this.msalService.loginRedirect({
      scopes: ['openid', 'profile', 'email'],
      prompt: 'select_account'
    });
  }

  logout(): void {
    // Clear authentication data
    this.clearAuthData();
    
    // Clear MSAL cache if there are any MSAL accounts
    const accounts = this.msalService.instance.getAllAccounts();
    if (accounts.length > 0) {
      this.msalService.instance.clearCache();
    }
    
    // Redirect to home page
    window.location.href = '/';
  }

  private handleAuthSuccess(response: AuthenticationResult): void {
    this.logger.info('Authentication successful');
    
    const account = response.account;
    if (account) {
      this.msalService.instance.setActiveAccount(account);
      this.setUserFromAccount(account);
    }
  }

  private setUserFromAccount(account: any): void {
    const user: User = {
      _id: account.localAccountId,
      azureObjectId: account.localAccountId,
      email: account.username,
      name: account.name || '',
      firstName: (account as any).given_name || account.name?.split(' ')[0] || '',
      lastName: (account as any).family_name || account.name?.split(' ').slice(1).join(' ') || '',
      phone: '',
      address: {
        street: '',
        city: '',
        state: '',
        zipCode: '',
        country: ''
      },
      role: 'user' as const,
      isVerified: true,
      isEmailConfirmed: true, // Azure AD users are considered email confirmed
      biddingStatus: {
        tier: 'basic' as const,
        isActive: true
      },
      reputation: {
        score: 0,
        totalBids: 0,
        totalWins: 0,
        totalSales: 0,
        positiveReviews: 0,
        negativeReviews: 0
      },
      createdAt: new Date(),
      lastLoginAt: new Date()
    };
    
    this.currentUserSubject.next(user);
    this.isAuthenticatedSubject.next(true);
  }

  public getAccessToken(): Observable<AuthenticationResult> {
    const account = this.msalService.instance.getActiveAccount();
    if (!account) {
      return throwError(() => new Error('No active account'));
    }

    return from(this.msalService.acquireTokenSilent({
      scopes: ['openid', 'profile', 'email'],
      account: account
    })).pipe(
      catchError((error) => {
        // If silent token acquisition fails, try interactive
        if (error.errorCode === 'interaction_required') {
          return this.msalService.acquireTokenPopup({
            scopes: ['openid', 'profile', 'email']
          });
        }
        return throwError(() => error);
      })
    );
  }

  private syncUserWithBackend(account: AccountInfo, accessToken: string): Observable<AuthResponse> {
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    });

    return this.http.post<AuthResponse>(`${this.apiUrl}/auth/sync`, {
      azureObjectId: account.localAccountId,
      email: account.username,
      name: account.name,
      firstName: (account as any).given_name || account.name?.split(' ')[0] || '',
      lastName: (account as any).family_name || account.name?.split(' ').slice(1).join(' ') || ''
    }, { headers }).pipe(
      tap((response) => {
        this.setAuthData(response);
        this.logger.info('User synced with backend successfully');
      }),
      catchError((error) => {
        this.logger.error('Failed to sync user with backend:', error);
        return throwError(() => error);
      })
    );
  }

  // Backend Authentication Methods
  login(email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiUrl}/auth/login`, { email, password })
      .pipe(
        tap((response) => {
          this.setAuthData(response);
        }),
        catchError(this.handleError)
      );
  }

  register(userData: {
    name: string;
    email: string;
    password: string;
  }): Observable<AuthResponse | { success: boolean; message: string; requiresEmailConfirmation: boolean; confirmationToken: string }> {
    return this.http
      .post<AuthResponse | { success: boolean; message: string; requiresEmailConfirmation: boolean; confirmationToken: string }>(`${this.apiUrl}/auth/register`, userData)
      .pipe(
        tap((response) => {
          // Check if email confirmation is required
          if ('requiresEmailConfirmation' in response && response.requiresEmailConfirmation) {
            // Don't set auth data yet - wait for email confirmation
            this.logger.info('Registration successful, email confirmation required');
          } else {
            // Regular registration without email confirmation
            this.setAuthData(response as AuthResponse);
          }
        }),
        catchError(this.handleError)
      );
  }

  refreshAccessToken(): Observable<AuthResponse> {
    const refreshToken = this.refreshTokenSubject.value;
    if (!refreshToken) {
      // Try to refresh with MSAL
      return this.getAccessToken().pipe(
        switchMap((response) => {
          const account = this.msalService.instance.getActiveAccount();
          if (account) {
            return this.syncUserWithBackend(account, response.accessToken);
          }
          return throwError(() => new Error('No active account'));
        })
      );
    }

    return this.http
      .post<AuthResponse>(`${this.apiUrl}/auth/refresh`, { refreshToken })
      .pipe(
        tap((response) => {
          this.setAuthData(response);
        }),
        catchError((error) => {
          this.clearAuthData();
          return throwError(() => error);
        })
      );
  }

  getCurrentUser(): Observable<User | null> {
    const token = this.getToken();
    if (!token) {
      return this.currentUser$;
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`
    });

    return this.http.get<User>(`${this.apiUrl}/auth/me`, { headers }).pipe(
      tap((user) => {
        this.currentUserSubject.next(user);
        localStorage.setItem('user', JSON.stringify(user));
      }),
      catchError((error) => {
        this.logger.error('Failed to get current user:', error);
        this.clearAuthData();
        return throwError(() => error);
      })
    );
  }

  getCurrentUserSync(): User | null {
    return this.currentUserSubject.value;
  }

  isAuthenticated(): boolean {
    const token = this.tokenSubject.value;
    const msalAccount = this.msalService.instance.getActiveAccount();
    return !!(token || msalAccount);
  }


  getToken(): string | null {
    return this.tokenSubject.value;
  }

  // Credit Card Pre-Authorization Methods
  createPreAuthorization(request: PreAuthRequest): Observable<PreAuthResponse> {
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.getToken()}`,
      'Content-Type': 'application/json'
    });

    return this.http.post<PreAuthResponse>(`${this.apiUrl}/auth/pre-auth`, request, { headers }).pipe(
      catchError(this.handleError)
    );
  }

  confirmPreAuthorization(preAuthId: string, paymentMethodId: string): Observable<PreAuthResponse> {
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.getToken()}`,
      'Content-Type': 'application/json'
    });

    return this.http.post<PreAuthResponse>(`${this.apiUrl}/auth/pre-auth/${preAuthId}/confirm`, {
      paymentMethodId
    }, { headers }).pipe(
      tap((response) => {
        if (response.status === 'succeeded') {
          this.updateUserBiddingStatus();
        }
      }),
      catchError(this.handleError)
    );
  }

  releasePreAuthorization(preAuthId: string): Observable<void> {
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.getToken()}`
    });

    return this.http.post<void>(`${this.apiUrl}/auth/pre-auth/${preAuthId}/release`, {}, { headers }).pipe(
      catchError(this.handleError)
    );
  }

  updateBiddingTier(tier: 'basic' | 'verified' | 'premium'): Observable<User> {
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.getToken()}`,
      'Content-Type': 'application/json'
    });

    return this.http.post<User>(`${this.apiUrl}/auth/update-tier`, { tier }, { headers }).pipe(
      tap((user) => {
        this.currentUserSubject.next(user);
        localStorage.setItem('user', JSON.stringify(user));
      }),
      catchError(this.handleError)
    );
  }

  private updateUserBiddingStatus(): void {
    this.getCurrentUser().subscribe({
      next: (user) => {
        this.logger.info('User bidding status updated');
      },
      error: (error) => {
        this.logger.error('Failed to update user bidding status:', error);
      }
    });
  }

  // Check if user can bid on specific auction
  canBidOnAuction(auctionId: string, bidAmount: number): Observable<boolean> {
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${this.getToken()}`
    });

    return this.http.post<{ canBid: boolean; reason?: string }>(
      `${this.apiUrl}/auth/can-bid`, 
      { auctionId, bidAmount }, 
      { headers }
    ).pipe(
      map(response => response.canBid),
      catchError(this.handleError)
    );
  }

  private setAuthData(response: AuthResponse): void {
    this.tokenSubject.next(response.token);
    this.refreshTokenSubject.next(response.refreshToken);
    this.currentUserSubject.next(response.user);
    this.isAuthenticatedSubject.next(true);

    localStorage.setItem('token', response.token);
    localStorage.setItem('refreshToken', response.refreshToken);
    localStorage.setItem('user', JSON.stringify(response.user));
  }

  private clearAuthData(): void {
    this.tokenSubject.next(null);
    this.refreshTokenSubject.next(null);
    this.currentUserSubject.next(null);
    this.isAuthenticatedSubject.next(false);

    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
  }

  // Email Confirmation Methods
  confirmEmail(token: string): Observable<{ success: boolean; message: string; user?: User }> {
    return this.http.post<{ success: boolean; message: string; user?: User }>(
      `${this.apiUrl}/auth/confirm-email`, 
      { token }
    ).pipe(
      tap((response) => {
        if (response.success && response.user) {
          // Update user data if email confirmation is successful
          this.currentUserSubject.next(response.user);
          this.isAuthenticatedSubject.next(true);
        }
      }),
      catchError(this.handleError)
    );
  }

  resendConfirmationEmail(email: string): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/auth/resend-confirmation`, 
      { email }
    ).pipe(
      catchError(this.handleError)
    );
  }

  private handleError = (error: any): Observable<never> => {
    this.logger.error('Auth error:', error);
    return throwError(() => error);
  };
}