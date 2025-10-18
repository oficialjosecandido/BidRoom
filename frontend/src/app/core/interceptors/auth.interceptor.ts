import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, from } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { MsalService } from '@azure/msal-angular';
import { MsalBroadcastService, MSAL_GUARD_CONFIG } from '@azure/msal-angular';
import { InteractionType, InteractionRequiredAuthError } from '@azure/msal-browser';
import { environment } from '@environments/environment';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(
    private msalService: MsalService,
    private msalBroadcastService: MsalBroadcastService
  ) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Skip adding token for certain URLs
    if (this.shouldSkipToken(req.url)) {
      return next.handle(req);
    }

    // Get token from MSAL or local storage
    return this.getToken().pipe(
      switchMap((token) => {
        if (token) {
          // Clone the request and add the authorization header
          const authReq = req.clone({
            setHeaders: {
              Authorization: `Bearer ${token}`
            }
          });
          return next.handle(authReq);
        } else {
          return next.handle(req);
        }
      }),
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401 && this.isMsalError(error)) {
          // Token might be expired, try to refresh
          return this.handleTokenRefresh(req, next);
        }
        return throwError(() => error);
      })
    );
  }

  private shouldSkipToken(url: string): boolean {
    const skipUrls = [
      '/auth/login',
      '/auth/register',
      '/auth/refresh',
      '/health',
      '/assets/',
      '/info',
      '/auctions/public',
      environment.azureAdB2C.authority
    ];
    
    // Skip token for any URL that doesn't contain the API base URL
    if (!url.includes(environment.apiUrl)) {
      return true;
    }
    
    return skipUrls.some(skipUrl => url.includes(skipUrl));
  }

         private getToken(): Observable<string | null> {
           const account = this.msalService.instance.getActiveAccount();
           
           if (!account) {
             return new Observable(observer => {
               observer.next('');
               observer.complete();
             });
           }

           return from(this.msalService.acquireTokenSilent({
             scopes: ['openid', 'profile', 'email'],
             account: account
           })).pipe(
             switchMap((response) => {
               return new Observable<string>(observer => {
                 observer.next(response.accessToken);
                 observer.complete();
               });
             }),
             catchError((error) => {
               console.log('Token acquisition failed:', error);
               // Return empty string for failed token acquisition
               return new Observable<string>(observer => {
                 observer.next('');
                 observer.complete();
               });
             })
           );
         }

  private isMsalError(error: HttpErrorResponse): boolean {
    return error.status === 401 && error.error?.code === 'invalid_token';
  }

  private handleTokenRefresh(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const account = this.msalService.instance.getActiveAccount();
    
    if (!account) {
      // No account, redirect to login
      this.msalService.loginRedirect();
      return throwError(() => new Error('No active account'));
    }

    return from(this.msalService.acquireTokenSilent({
      scopes: ['openid', 'profile', 'email'],
      account: account
    })).pipe(
      switchMap((response) => {
        // Retry the original request with new token
        const authReq = req.clone({
          setHeaders: {
            Authorization: `Bearer ${response.accessToken}`
          }
        });
        return next.handle(authReq);
      }),
      catchError((error) => {
        if (error instanceof InteractionRequiredAuthError) {
          // Try interactive acquisition
          return from(this.msalService.acquireTokenPopup({
            scopes: ['openid', 'profile', 'email']
          })).pipe(
            switchMap((response) => {
              const authReq = req.clone({
                setHeaders: {
                  Authorization: `Bearer ${response.accessToken}`
                }
              });
              return next.handle(authReq);
            })
          );
        }
        // If all else fails, redirect to login
        this.msalService.loginRedirect();
        return throwError(() => error);
      })
    );
  }
}
