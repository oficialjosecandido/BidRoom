import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface DeliveryAddress {
  street1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface ShippingRate {
  id: string;
  carrier: string;
  service: string;
  rate: number;
  currency: string;
  deliveryDays: number | null;
  deliveryDate: string | null;
}

export interface ShippingRatesResponse {
  rates: ShippingRate[];
  origin: { postalCode: string; country: string };
}

export interface LockRateResponse {
  success: boolean;
  shippingAmount: number;
  carrier: string;
  service: string;
  deliveryDays: number | null;
}

@Injectable({ providedIn: 'root' })
export class ShippingService {
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/shipping`;

  calculateRates(transactionId: string, destination: DeliveryAddress): Observable<ShippingRatesResponse> {
    return this.http.post<ShippingRatesResponse>(`${this.apiUrl}/rates`, { transactionId, destination });
  }

  lockRate(
    transactionId: string,
    rate: ShippingRate,
    destination: DeliveryAddress
  ): Observable<LockRateResponse> {
    return this.http.post<LockRateResponse>(`${this.apiUrl}/lock-rate`, {
      transactionId,
      rateId: rate.id,
      carrier: rate.carrier,
      service: rate.service,
      rate: rate.rate,
      deliveryDays: rate.deliveryDays,
      destination
    });
  }
}
