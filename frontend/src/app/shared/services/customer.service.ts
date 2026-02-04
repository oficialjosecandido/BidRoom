import { Injectable } from '@angular/core';
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
  buyerScore: number | null;
  sellerScore: number | null;
  buyerReviewCount: number;
  sellerReviewCount: number;
}

@Injectable({
  providedIn: 'root'
})
export class CustomerService {
  private apiUrl = `${API_CONFIG.getApiUrl()}/customers`;

  constructor(private http: HttpClient) {}

  getCustomer(): Observable<CustomerInfo> {
    return this.http.get<CustomerInfo>(`${this.apiUrl}/profile`);
  }
}
