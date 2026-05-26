import { Injectable, inject } from '@angular/core';
import {
  CanActivate,
  Router,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { Observable, from, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { Auth } from '@angular/fire/auth';
import { UserRolesService } from '../../shared/services/user-roles.service';

const ADMIN_ROUTE_KEY = 'admin_route';

@Injectable({ providedIn: 'root' })
export class AdminGuard implements CanActivate {
  private router = inject(Router);
  private auth = inject(Auth);
  private userRoles = inject(UserRolesService);

  canActivate(
    _route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> {
    localStorage.setItem(ADMIN_ROUTE_KEY, state.url);

    return this.waitForAuth().pipe(
      switchMap(() => {
        const fbUser = this.auth.currentUser;
        if (!fbUser || !fbUser.emailVerified) {
          this.handleUnauthorized(state);
          return of(false);
        }
        return this.userRoles.load().pipe(
          switchMap((roles) => {
            if (roles.isAdmin) return of(true);
            localStorage.removeItem(ADMIN_ROUTE_KEY);
            this.router.navigate(['/landing']);
            return of(false);
          })
        );
      }),
      catchError(() => {
        this.handleUnauthorized(state);
        return of(false);
      })
    );
  }

  /**
   * Resolves once Firebase has restored the cached auth session (page refresh
   * scenario) or after a short timeout if it never fires.
   */
  private waitForAuth(): Observable<void> {
    if (this.auth.currentUser !== null) return of(void 0);
    return from(
      new Promise<void>((resolve) => {
        const unsubscribe = this.auth.onAuthStateChanged(() => {
          unsubscribe();
          resolve();
        });
        setTimeout(() => {
          unsubscribe();
          resolve();
        }, 3000);
      })
    );
  }

  private handleUnauthorized(state: RouterStateSnapshot): void {
    this.router.navigate(['/auth/login'], {
      queryParams: { returnUrl: state.url },
    });
  }

  static getAdminRoute(): string | null {
    return localStorage.getItem(ADMIN_ROUTE_KEY);
  }

  static clearAdminRoute(): void {
    localStorage.removeItem(ADMIN_ROUTE_KEY);
  }
}
