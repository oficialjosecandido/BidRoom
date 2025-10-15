import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MsalService } from '@azure/msal-angular';
import { environment } from '@environments/environment';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  reputationScore: number;
  canBid: boolean;
  avatar?: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private apiUrl = environment.apiUrl;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(
    private http: HttpClient,
    private msalService: MsalService
  ) {
    this.initializeUser();
  }

  private initializeUser(): void {
    const accounts = this.msalService.instance.getAllAccounts();
    if (accounts.length > 0) {
      this.loadUserProfile().subscribe();
    }
  }

  login(): void {
    this.msalService.loginRedirect();
  }

  logout(): void {
    this.msalService.logoutRedirect();
    this.currentUserSubject.next(null);
  }

  loadUserProfile(): Observable<User> {
    return this.http.get<User>(`${this.apiUrl}/auth/profile`).pipe(
      tap((user) => {
        this.currentUserSubject.next(user);
      })
    );
  }

  isAuthenticated(): boolean {
    return this.msalService.instance.getAllAccounts().length > 0;
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  getAccessToken(): Observable<string> {
    return new Observable((observer) => {
      this.msalService.instance
        .acquireTokenSilent({
          scopes: ['openid', 'profile', 'email'],
          account: this.msalService.instance.getAllAccounts()[0],
        })
        .then((response) => {
          observer.next(response.accessToken);
          observer.complete();
        })
        .catch((error) => {
          observer.error(error);
        });
    });
  }
}

