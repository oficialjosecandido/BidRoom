import { Injectable } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Observable } from 'rxjs';
import { map, take, filter, switchMap } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> {
    return this.authService.authReady$.pipe(
      filter(ready => ready),
      take(1),
      switchMap(() => this.authService.currentUser$.pipe(take(1))),
      map(user => {
        if (!user) {
          this.router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url } });
          return false;
        }
        if (!user.emailVerified) {
          this.router.navigate(['/auth/login'], {
            queryParams: { returnUrl: state.url, verifyEmail: 'true' }
          });
          return false;
        }
        return true;
      })
    );
  }
}
