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
  accountStatus?: 'active' | 'suspended' | 'closed';
  hasDeposit?: boolean;
  depositAmount?: number;
  lastLogin?: string;
  createdAt?: string;
}

/** DSA / trader identity (from User); null if user record not linked yet */
export interface SellerCompliance {
  sellerClassification: 'private' | 'professional';
  professionalVerificationStatus: 'none' | 'pending' | 'verified' | 'rejected';
  professionalLegalName?: string | null;
  professionalTradeName?: string | null;
  professionalAddressLine1?: string | null;
  professionalAddressLine2?: string | null;
  professionalCity?: string | null;
  professionalRegion?: string | null;
  professionalPostalCode?: string | null;
  professionalCountry?: string | null;
  professionalContactPhone?: string | null;
  professionalContactEmail?: string | null;
  professionalVatId?: string | null;
  professionalSubmittedAt?: string | null;
  professionalVerifiedAt?: string | null;
  professionalVerifiedByEmail?: string | null;
  professionalRejectionNote?: string | null;
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
  /** Present when linked User exists (DSA seller classification). */
  sellerCompliance?: SellerCompliance | null;
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

  updateSellerCompliance(payload: Record<string, unknown>): Observable<{
    sellerClassification: string;
    professionalVerificationStatus: string;
    professionalSubmittedAt?: string | null;
    message: string;
  }> {
    return this.http.patch<{
      sellerClassification: string;
      professionalVerificationStatus: string;
      professionalSubmittedAt?: string | null;
      message: string;
    }>(`${this.apiUrl}/seller-compliance`, payload);
  }
}
