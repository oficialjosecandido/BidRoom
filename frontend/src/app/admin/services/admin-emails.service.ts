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
  /** Emails successfully sent to this address, across every campaign. */
  emailsReceived: number;
  emailsOpened: number;
  lastEmailAt: string | null;
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
  campaignId?: string;
}

export type CampaignKind = 'newsletter' | 'personalized' | 'draft-reminder';

/** One line in the sent-email history. */
export interface EmailCampaignRow {
  _id: string;
  kind: CampaignKind;
  audience: EmailAudience | null;
  subject: string;
  isoWeek: number;
  isoYear: number;
  /** e.g. "S30/2026". */
  weekLabel: string;
  sentAt: string;
  sentByEmail: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  /** Recipients who opened at least once — approximate, see the history note. */
  openedCount: number;
  totalOpens: number;
  openRate: number;
}

export interface CampaignDelivery {
  _id: string;
  email: string;
  recipientType: ContactType;
  language: CampaignLanguage;
  status: 'sent' | 'failed';
  error: string | null;
  openedAt: string | null;
  lastOpenedAt: string | null;
  openCount: number;
  createdAt: string;
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

  // Sent history
  getCampaigns(limit = 50, skip = 0): Observable<{ campaigns: EmailCampaignRow[]; total: number }> {
    const params = new HttpParams().set('limit', limit).set('skip', skip);
    return this.http.get<{ campaigns: EmailCampaignRow[]; total: number }>(`${this.apiUrl}/campaigns`, { params });
  }

  getCampaignDeliveries(id: string): Observable<{ deliveries: CampaignDelivery[] }> {
    return this.http.get<{ deliveries: CampaignDelivery[] }>(`${this.apiUrl}/campaigns/${id}/deliveries`);
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
