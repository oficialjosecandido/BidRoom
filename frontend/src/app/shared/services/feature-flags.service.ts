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

/** Ceiling on what a vehicle may be listed for; mirrors backend vehicleRules. */
const DEFAULT_MAX_VEHICLE_VALUE_EUR = 20000;

@Injectable({ providedIn: 'root' })
export class FeatureFlagsService {
  private http = inject(HttpClient);
  private flags$ = new BehaviorSubject<FeatureFlags>(DEFAULT_FLAGS);
  private maxVehicleValue$ = new BehaviorSubject<number>(DEFAULT_MAX_VEHICLE_VALUE_EUR);

  constructor() {
    this.http.get<{ features: Partial<FeatureFlags>; vehicles?: { maxValueEur?: number } }>(
      `${API_CONFIG.getApiUrl()}/config`
    ).subscribe({
      next: (res) => {
        this.flags$.next({ ...DEFAULT_FLAGS, ...res.features });
        if (typeof res.vehicles?.maxValueEur === 'number' && res.vehicles.maxValueEur > 0) {
          this.maxVehicleValue$.next(res.vehicles.maxValueEur);
        }
      },
      error: () => { /* keep environment defaults on failure */ }
    });
  }

  get flags(): FeatureFlags {
    return this.flags$.value;
  }

  /**
   * The vehicle value ceiling, so the seller sees the limit while setting a
   * price. The backend enforces it regardless of what this returns.
   */
  get maxVehicleValueEur(): number {
    return this.maxVehicleValue$.value;
  }
}
