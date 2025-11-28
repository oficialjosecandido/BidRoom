import { Injectable, inject } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Observable, of, from } from 'rxjs';
import { map, timeout, catchError, switchMap } from 'rxjs/operators';
import { AuthService } from '../../auth/services/auth.service';
import { Auth } from '@angular/fire/auth';

const ADMIN_EMAIL = 'josevcandido@gmail.com';
const ADMIN_ROUTE_KEY = 'admin_route';

@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {
  private auth = inject(Auth);

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> {
    // Save admin route to localStorage
    localStorage.setItem(ADMIN_ROUTE_KEY, state.url);

    // Check Firebase directly first (fast path)
    const fbUser = this.auth.currentUser;
    if (fbUser && fbUser.emailVerified && fbUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      return of(true);
    }

    // If no user in Firebase yet, check if we have a saved admin route
    // This means user was previously on admin page, so wait for auth to restore
    const savedRoute = localStorage.getItem(ADMIN_ROUTE_KEY);
    if (!savedRoute || !savedRoute.startsWith('/nexus')) {
      // Not an admin route, proceed with normal check
      this.handleUnauthorized(state);
      return of(false);
    }

    // Wait for Firebase to restore session (user was on admin page before refresh)
    return from(
      new Promise<void>((resolve) => {
        if (this.auth.currentUser !== null) {
          resolve();
          return;
        }

        const unsubscribe = this.auth.onAuthStateChanged((user) => {
          unsubscribe();
          resolve();
        });

        setTimeout(() => {
          unsubscribe();
          resolve();
        }, 3000);
      })
    ).pipe(
      switchMap(() => {
        const fbUser = this.auth.currentUser;
        if (!fbUser || !fbUser.emailVerified) {
          this.handleUnauthorized(state);
          return of(false);
        }

        if (fbUser.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
          localStorage.removeItem(ADMIN_ROUTE_KEY);
          this.router.navigate(['/landing']);
          return of(false);
        }

        return of(true);
      }),
      catchError(() => {
        const fbUser = this.auth.currentUser;
        if (fbUser && fbUser.emailVerified && fbUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
          return of(true);
        }
        this.handleUnauthorized(state);
        return of(false);
      })
    );
  }

  private handleUnauthorized(state: RouterStateSnapshot): void {
    this.router.navigate(['/auth/login'], { 
      queryParams: { returnUrl: state.url } 
    });
  }

  static getAdminRoute(): string | null {
    return localStorage.getItem(ADMIN_ROUTE_KEY);
  }

  static clearAdminRoute(): void {
    localStorage.removeItem(ADMIN_ROUTE_KEY);
  }
}

