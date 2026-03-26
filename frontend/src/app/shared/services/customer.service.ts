import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export interface CustomerUser {
  _id: string;
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
  isActive: boolean;
  hasDeposit?: boolean;
  depositAmount?: number;
  lastLogin?: string;
  createdAt?: string;
}

export interface CustomerInfo {
  user: CustomerUser;
  balance: number;
  reviewCount: number;
  language: string;
  buyerScore: number | null;
  sellerScore: number | null;
  buyerReviewCount: number;
  sellerReviewCount: number;
  stripeConnectOnboarded: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class CustomerService {
  private http = inject(HttpClient);

  private apiUrl = `${API_CONFIG.getApiUrl()}/customers`;

  getCustomer(): Observable<CustomerInfo> {
    return this.http.get<CustomerInfo>(`${this.apiUrl}/profile`);
  }

  updateLanguage(language: string): Observable<{ language: string }> {
    return this.http.patch<{ language: string }>(`${this.apiUrl}/language`, { language });
  }
}
