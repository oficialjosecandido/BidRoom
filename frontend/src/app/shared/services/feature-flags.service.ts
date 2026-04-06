import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface FeatureFlags {
  membershipTiers: boolean;
}

/** Defaults until GET /api/config responds — match backend (tiers off unless FEATURE_MEMBERSHIP_TIERS=true). */
const DEFAULT_FLAGS: FeatureFlags = {
  membershipTiers: false
};

@Injectable({ providedIn: 'root' })
export class FeatureFlagsService {
  private http = inject(HttpClient);
  private flags$ = new BehaviorSubject<FeatureFlags>(DEFAULT_FLAGS);

  constructor() {
    this.http.get<{ features: FeatureFlags }>(`${API_CONFIG.getApiUrl()}/config`)
      .subscribe({
        next: (res) => this.flags$.next({ ...DEFAULT_FLAGS, ...res.features }),
        error: () => { /* keep defaults on failure */ }
      });
  }

  get flags(): FeatureFlags {
    return this.flags$.value;
  }
}
