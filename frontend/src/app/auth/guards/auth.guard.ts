import { Injectable } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';
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
    return this.authService.currentUser$.pipe(
      take(1),
      map(user => {
        if (!user) {
          // Not logged in - redirect to login
          this.router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url } });
          return false;
        }
        
        if (!user.emailVerified) {
          // Logged in but email not verified - redirect to login with message
          this.router.navigate(['/auth/login'], { 
            queryParams: { 
              returnUrl: state.url,
              verifyEmail: 'true'
            } 
          });
          return false;
        }
        
        // User is authenticated and verified
        return true;
      })
    );
  }
}
