import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';
import { SocketService } from './socket.service';

export interface SupportConversation {
  _id: string;
  customer: { firstName: string; lastName: string; email: string; reputationScore: number } | string;
  customerUid: string;
  status: 'open' | 'pending_customer' | 'pending_agent' | 'resolved' | 'closed';
  category: 'payment' | 'shipping' | 'dispute' | 'account' | 'listing' | 'other';
  subject: string;
  assignedAgent: string | null;
  lastMessageAt: string;
  lastMessageBy: 'customer' | 'agent' | 'system';
  unreadByAgent: number;
  unreadByCustomer: number;
  createdAt: string;
}

export interface SupportMessage {
  _id: string;
  conversation: string;
  senderType: 'customer' | 'agent' | 'system';
  senderName: string;
  body: string;
  readByRecipient: boolean;
  createdAt: string;
}

export interface OpenConversationPayload {
  subject?: string;
  category?: string;
  initialMessage?: string;
  relatedTransaction?: string;
  relatedListing?: string;
}

@Injectable({ providedIn: 'root' })
export class SupportService {
  private http   = inject(HttpClient);
  private socket = inject(SocketService);
  private base   = `${API_CONFIG.getApiUrl()}/support`;

  openConversation(payload: OpenConversationPayload): Observable<{ conversation: SupportConversation }> {
    return this.http.post<{ conversation: SupportConversation }>(`${this.base}/conversations`, payload);
  }

  getMyConversations(): Observable<{ conversations: SupportConversation[] }> {
    return this.http.get<{ conversations: SupportConversation[] }>(`${this.base}/conversations/mine`);
  }

  getMessages(conversationId: string): Observable<{ messages: SupportMessage[] }> {
    return this.http.get<{ messages: SupportMessage[] }>(`${this.base}/conversations/${conversationId}/messages`);
  }

  sendMessage(conversationId: string, body: string): Observable<{ message: SupportMessage }> {
    return this.http.post<{ message: SupportMessage }>(
      `${this.base}/conversations/${conversationId}/messages`,
      { body }
    );
  }

  getAdminConversations(
    params: { status?: string; page?: number; category?: string; assignedAgent?: string } = {}
  ): Observable<{ conversations: SupportConversation[]; total: number; pages: number }> {
    let p = new HttpParams();
    if (params.status)        p = p.set('status',        params.status);
    if (params.category)      p = p.set('category',      params.category);
    if (params.assignedAgent) p = p.set('assignedAgent', params.assignedAgent);
    if (params.page != null)  p = p.set('page',          String(params.page));
    return this.http.get<{ conversations: SupportConversation[]; total: number; pages: number }>(
      `${this.base}/admin/conversations`,
      { params: p }
    );
  }

  updateAdminConversation(
    conversationId: string,
    update: { status?: SupportConversation['status']; assignedAgent?: string | null; category?: string }
  ): Observable<{ conversation: SupportConversation }> {
    return this.http.patch<{ conversation: SupportConversation }>(
      `${this.base}/admin/conversations/${conversationId}`,
      update
    );
  }

  onSupportMessage(): Observable<{ conversationId: string; message: SupportMessage }> {
    return this.socket.onSupportMessage() as unknown as Observable<{ conversationId: string; message: SupportMessage }>;
  }

  onConversationUpdated(): Observable<{ conversationId: string; status: string }> {
    return this.socket.onSupportConversationUpdated();
  }

  joinSupportAgents():  void { this.socket.joinSupportAgents(); }
  leaveSupportAgents(): void { this.socket.leaveSupportAgents(); }
}
