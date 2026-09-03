import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../../shared/config/api.config';

export type EmailAudience = 'all_contacts' | 'all_users' | 'interested';

export type CampaignLanguage = 'pt' | 'en' | 'es' | 'fr';

export type ContactType = 'customer' | 'interested';

export interface UnifiedContact {
  _id: string;
  type: ContactType;
  isCustomer: boolean;
  email: string;
  name?: string | null;
  language: CampaignLanguage;
  unsubscribed: boolean;
  createdAt: string;
}

export interface ContactPreferencesUpdate {
  language?: CampaignLanguage;
  unsubscribed?: boolean;
}

export interface LanguageContent {
  subject: string;
  html: string;
}

export type CampaignContent = Record<CampaignLanguage, LanguageContent>;

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
  language?: CampaignLanguage;
  unsubscribed?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AdminEmailsService {
  private http = inject(HttpClient);

  private get apiUrl(): string {
    return `${API_CONFIG.getApiUrl()}/admin/emails`;
  }

  // Unified contacts (customers + interested)
  getContacts(): Observable<{ contacts: UnifiedContact[] }> {
    return this.http.get<{ contacts: UnifiedContact[] }>(`${this.apiUrl}/contacts`);
  }

  addInterestedContact(email: string, name?: string, language?: CampaignLanguage): Observable<{ contact: UnifiedContact }> {
    return this.http.post<{ contact: UnifiedContact }>(`${this.apiUrl}/interested`, { email, name, language });
  }

  updateContact(type: ContactType, id: string, updates: ContactPreferencesUpdate): Observable<{ contact: UnifiedContact }> {
    return this.http.patch<{ contact: UnifiedContact }>(`${this.apiUrl}/contacts/${type}/${id}`, updates);
  }

  removeInterestedContact(id: string): Observable<{ ok: boolean; deletedId: string }> {
    return this.http.delete<{ ok: boolean; deletedId: string }>(`${this.apiUrl}/interested/${id}`);
  }

  // Newsletter
  getAudienceCount(audience: EmailAudience): Observable<{ count: number }> {
    const params = new HttpParams().set('audience', audience);
    return this.http.get<{ count: number }>(`${this.apiUrl}/audience-count`, { params });
  }

  sendTest(subject: string, html: string, language: CampaignLanguage): Observable<{ ok: boolean; to: string }> {
    return this.http.post<{ ok: boolean; to: string }>(`${this.apiUrl}/test`, { subject, html, language });
  }

  sendCampaign(content: CampaignContent, audience: EmailAudience): Observable<SendResult> {
    return this.http.post<SendResult>(`${this.apiUrl}/send`, { content, audience });
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
