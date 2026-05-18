import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { API_CONFIG } from '../config/api.config';
import { environment } from '../../../environments/environment';

export interface FeatureFlags {
  /** Frontend flags (from environment.featureFlags) */
  auctions:              boolean;
  privateRooms:          boolean;
  bestOffers:            boolean;
  reviews:               boolean;
  /** Backend flags (from GET /api/config, overrides environment default) */
  membershipTiers:       boolean;
  createListingOutsidePt: boolean;
  requireNif:            boolean;
}

/** Seed from environment so the app renders correctly before the API responds. */
const DEFAULT_FLAGS: FeatureFlags = {
  ...environment.featureFlags,
  createListingOutsidePt: false,
  requireNif:             false,
};

@Injectable({ providedIn: 'root' })
export class FeatureFlagsService {
  private http = inject(HttpClient);
  private flags$ = new BehaviorSubject<FeatureFlags>(DEFAULT_FLAGS);

  constructor() {
    this.http.get<{ features: Partial<FeatureFlags> }>(`${API_CONFIG.getApiUrl()}/config`)
      .subscribe({
        next: (res) => this.flags$.next({ ...DEFAULT_FLAGS, ...res.features }),
        error: () => { /* keep environment defaults on failure */ }
      });
  }

  get flags(): FeatureFlags {
    return this.flags$.value;
  }
}
