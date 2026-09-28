import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, from, throwError } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<any>,
  next: HttpHandlerFn
): Observable<any> => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Attach Firebase ID token when available
  return from(authService.getAccessToken()).pipe(
    switchMap((token) => {
      if (token) {
        req = req.clone({
          setHeaders: {
            Authorization: `Bearer ${token}`
          }
        });
      }
      return next(req).pipe(
        catchError((err: HttpErrorResponse) => {
          // Only a request that actually carried a token can have an expired session.
          // Without this guard, an anonymous visitor hitting any auth-only endpoint
          // (a guest submitting a listing, say) gets thrown to the login page.
          if (err.status === 401 && token) {
            authService.logout().subscribe({
              complete: () => router.navigate(['/auth/login'])
            });
          }
          return throwError(() => err);
        })
      );
    })
  );
};
