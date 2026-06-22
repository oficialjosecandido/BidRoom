import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { Auth, GoogleAuthProvider, User as FirebaseUser, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, sendEmailVerification, updateProfile, signOut, getIdToken, confirmPasswordReset, verifyPasswordResetCode } from '@angular/fire/auth';
import { API_CONFIG } from '../../shared/config/api.config';
import { UserRolesService } from '../../shared/services/user-roles.service';
import { PostHogService } from '../../shared/services/posthog.service';
import { AnalyticsEvents } from '../../shared/services/analytics.events';

export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth      = inject(Auth);
  private http      = inject(HttpClient);
  private userRoles = inject(UserRolesService);
  private postHog   = inject(PostHogService);
  private apiUrl = API_CONFIG.getApiUrl();

  private currentUserSubject = new BehaviorSubject<AppUser | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  /** Emits true once Firebase has completed the initial auth state check (e.g. on page refresh). */
  private authReadySubject = new BehaviorSubject<boolean>(false);
  public authReady$ = this.authReadySubject.asObservable();

  constructor() {
    onAuthStateChanged(this.auth, async (fbUser: FirebaseUser | null) => {
      if (fbUser && !fbUser.emailVerified) {
        // User is logged in but email is not verified - sign them out
        await signOut(this.auth);
        this.currentUserSubject.next(null);
        this.userRoles.invalidate();
        this.authReadySubject.next(true);
        return;
      }
      const mapped = this.mapFirebaseUser(fbUser);
      this.currentUserSubject.next(mapped);
      this.authReadySubject.next(true);

      if (!mapped) {
        this.userRoles.invalidate();
        this.postHog.reset();
        return;
      }

      this.postHog.identify(mapped.uid, {
        email:          mapped.email ?? '',
        email_verified: mapped.emailVerified,
      });

      // Refresh role flags for the new user, then route admins to a saved
      // /nexus route (handles page-refresh scenario for support staff).
      this.userRoles.invalidate();
      this.userRoles.load().subscribe((roles) => {
        if (!roles.isAdmin) return;
        // Guard: localStorage and window.location are browser-only.
        // onAuthStateChanged fires with a null user on the server (no persistence),
        // so mapped is always null there and we never reach this block on SSR.
        if (typeof localStorage === 'undefined' || typeof window === 'undefined') return;
        const adminRoute = localStorage.getItem('admin_route');
        if (!adminRoute) return;
        const currentPath = window.location.pathname;
        if ((currentPath.startsWith('/auth') || currentPath === '/landing' || currentPath === '/') && !currentPath.startsWith('/nexus')) {
          setTimeout(() => {
            window.location.href = adminRoute;
          }, 100);
        }
      });
    });
  }

  private mapFirebaseUser(user: FirebaseUser | null): AppUser | null {
    if (!user) return null;
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      emailVerified: user.emailVerified
    };
  }

  login(email: string, password: string): Observable<AppUser> {
    return from(signInWithEmailAndPassword(this.auth, email, password)).pipe(
      switchMap((cred) => {
        if (!cred.user.emailVerified) {
          return from(signOut(this.auth)).pipe(
            switchMap(() => throwError(() => new Error('Please verify your email address before logging in. Check your inbox for the verification email.')))
          );
        }
        this.postHog.track(AnalyticsEvents.LOGIN, { method: 'email' });
        return of(this.mapFirebaseUser(cred.user) as AppUser);
      }),
      catchError((err) => {
        // Report failed attempt to backend for brute-force tracking (best-effort, non-blocking)
        const firebaseFailureCodes = ['auth/wrong-password', 'auth/invalid-credential', 'auth/user-not-found', 'auth/invalid-password'];
        if (email && firebaseFailureCodes.some(c => err?.code === c)) {
          this.http.post(`${API_CONFIG.getApiUrl()}/auth/login-failure`, { email })
            .subscribe({ error: () => {} }); // fire-and-forget
        }
        return throwError(() => err);
      })
    );
  }

  register(email: string, password: string, displayName?: string): Observable<AppUser> {
    return from(createUserWithEmailAndPassword(this.auth, email, password)).pipe(
      switchMap(async (cred) => {
        if (displayName) {
          await updateProfile(cred.user, { displayName });
        }
        await sendEmailVerification(cred.user);
        this.postHog.track(AnalyticsEvents.SIGN_UP, { method: 'email' });
        return this.mapFirebaseUser(cred.user) as AppUser;
      })
    );
  }

  loginWithGoogle(): Observable<AppUser> {
    const provider = new GoogleAuthProvider();
    return from(signInWithPopup(this.auth, provider)).pipe(
      switchMap((cred) => {
        if (!cred.user.emailVerified) {
          return from(signOut(this.auth)).pipe(
            switchMap(() => throwError(() => new Error('Your Google account email must be verified. Please verify your email address in your Google account settings.')))
          );
        }
        const isNew = (cred as unknown as { _tokenResponse?: { isNewUser?: boolean } })._tokenResponse?.isNewUser;
        this.postHog.track(isNew ? AnalyticsEvents.SIGN_UP : AnalyticsEvents.LOGIN, { method: 'google' });
        return of(this.mapFirebaseUser(cred.user) as AppUser);
      })
    );
  }

  forgotPassword(email: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/auth/forgot-password`, { email });
  }

  confirmPasswordReset(code: string, newPassword: string): Observable<void> {
    return from(confirmPasswordReset(this.auth, code, newPassword));
  }

  verifyPasswordResetCode(code: string): Observable<string> {
    return from(verifyPasswordResetCode(this.auth, code));
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.auth.currentUser) return null;
    return await getIdToken(this.auth.currentUser, false);
  }

  isAuthenticated(): Observable<boolean> {
    return this.currentUser$.pipe(map(user => !!user && user.emailVerified === true));
  }
  
  isAuthenticatedButNotVerified(): Observable<boolean> {
    return this.currentUser$.pipe(map(user => !!user && user.emailVerified === false));
  }

  getCurrentUser(): AppUser | null {
    return this.currentUserSubject.value;
  }

  logout(): Observable<void> {
    localStorage.clear();
    sessionStorage.clear();
    // Clear all cookies for this domain
    document.cookie.split(';').forEach(cookie => {
      const name = cookie.split('=')[0].trim();
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    });
    this.userRoles.invalidate();
    return from(signOut(this.auth));
  }
}
