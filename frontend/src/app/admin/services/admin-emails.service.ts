import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../../shared/config/api.config';

export type EmailAudience = 'all_users' | 'interested';

export interface InterestedContact {
  _id: string;
  email: string;
  name?: string;
  createdAt: string;
}

export interface SendResult {
  total: number;
  sent: number;
  failed: number;
}

export interface DraftReminderRow {
  _id: string;
  sellerId: string;
  sellerName: string;
  sellerEmail: string;
  draftTitle: string | null;
  updatedAt: string;
  draftReminderSent: boolean;
  previewSubject: string;
  previewHtml: string;
}

export interface CustomerSearchResult {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  language?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminEmailsService {
  private http = inject(HttpClient);

  private get apiUrl(): string {
    return `${API_CONFIG.getApiUrl()}/admin/emails`;
  }

  // Interested contacts
  getInterestedContacts(): Observable<{ contacts: InterestedContact[] }> {
    return this.http.get<{ contacts: InterestedContact[] }>(`${this.apiUrl}/interested`);
  }

  addInterestedContact(email: string, name?: string): Observable<{ contact: InterestedContact }> {
    return this.http.post<{ contact: InterestedContact }>(`${this.apiUrl}/interested`, { email, name });
  }

  removeInterestedContact(id: string): Observable<{ ok: boolean; deletedId: string }> {
    return this.http.delete<{ ok: boolean; deletedId: string }>(`${this.apiUrl}/interested/${id}`);
  }

  // Newsletter
  getAudienceCount(audience: EmailAudience): Observable<{ count: number }> {
    const params = new HttpParams().set('audience', audience);
    return this.http.get<{ count: number }>(`${this.apiUrl}/audience-count`, { params });
  }

  sendTest(subject: string, html: string): Observable<{ ok: boolean; to: string }> {
    return this.http.post<{ ok: boolean; to: string }>(`${this.apiUrl}/test`, { subject, html });
  }

  sendCampaign(subject: string, html: string, audience: EmailAudience): Observable<SendResult> {
    return this.http.post<SendResult>(`${this.apiUrl}/send`, { subject, html, audience });
  }

  // Personalized: draft reminders
  getDraftReminders(): Observable<{ drafts: DraftReminderRow[] }> {
    return this.http.get<{ drafts: DraftReminderRow[] }>(`${this.apiUrl}/draft-reminders`);
  }

  sendDraftReminder(draftId: string, subject: string, html: string): Observable<{ ok: boolean; sentTo: string }> {
    return this.http.post<{ ok: boolean; sentTo: string }>(`${this.apiUrl}/draft-reminders/${draftId}/send`, { subject, html });
  }

  // Personalized: any customer
  searchCustomers(q: string): Observable<{ customers: CustomerSearchResult[] }> {
    const params = new HttpParams().set('q', q);
    return this.http.get<{ customers: CustomerSearchResult[] }>(`${this.apiUrl}/customers/search`, { params });
  }

  sendToCustomer(customerId: string, subject: string, html: string): Observable<{ ok: boolean; sentTo: string }> {
    return this.http.post<{ ok: boolean; sentTo: string }>(`${this.apiUrl}/customers/${customerId}/send`, { subject, html });
  }
}
