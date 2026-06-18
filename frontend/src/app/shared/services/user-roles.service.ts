import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, ReplaySubject, of } from 'rxjs';
import { catchError, shareReplay, tap } from 'rxjs/operators';
import { API_CONFIG } from '../config/api.config';
import { logger } from '../utils/logger';

export interface UserRoles {
  email: string | null;
  uid: string | null;
  isAdmin: boolean;
  isAuthenticated: boolean;
}

const ANONYMOUS_ROLES: UserRoles = {
  email: null,
  uid: null,
  isAdmin: false,
  isAuthenticated: false,
};

/**
 * Source of truth for role flags on the frontend.
 *
 * The list of admin emails is server-only — we never ship it in the bundle.
 * The roles are fetched from `/api/users/me/roles` once per logged-in user and
 * cached in memory until `invalidate()` is called (on login / logout).
 */
@Injectable({ providedIn: 'root' })
export class UserRolesService {
  private http      = inject(HttpClient);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private rolesSubject = new ReplaySubject<UserRoles>(1);
  /** Last value, so synchronous callers can fall back to a cached answer. */
  private lastValue: UserRoles = ANONYMOUS_ROLES;
  private pending$: Observable<UserRoles> | null = null;

  readonly roles$ = this.rolesSubject.asObservable();

  /** Cached, synchronous snapshot. Defaults to the anonymous role set. */
  get snapshot(): UserRoles {
    return this.lastValue;
  }

  /** Convenience flag for templates / guards that already loaded the cache. */
  get isAdmin(): boolean {
    return this.lastValue.isAdmin;
  }

  /**
   * Fetch (or return the cached) role flags for the current authenticated
   * user. Anonymous users get a resolved Observable with the anonymous roles.
   */
  load(): Observable<UserRoles> {
    if (!this.isBrowser) return of(ANONYMOUS_ROLES);
    if (this.pending$) return this.pending$;
    this.pending$ = this.http.get<UserRoles>(`${API_CONFIG.getApiUrl()}/users/me/roles`).pipe(
      tap((roles) => {
        this.lastValue = roles;
        this.rolesSubject.next(roles);
      }),
      catchError((err) => {
        logger.warn('Failed to load user roles, treating as anonymous', err);
        this.lastValue = ANONYMOUS_ROLES;
        this.rolesSubject.next(ANONYMOUS_ROLES);
        return of(ANONYMOUS_ROLES);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.pending$;
  }

  /** Invalidate the cache (call on login/logout or when auth state changes). */
  invalidate(): void {
    this.pending$ = null;
    this.lastValue = ANONYMOUS_ROLES;
    this.rolesSubject.next(ANONYMOUS_ROLES);
  }
}
