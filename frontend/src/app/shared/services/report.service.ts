import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export type ReportType = 'listing' | 'user';
export type ReportReason = 'fraud_scam' | 'offensive_content' | 'prohibited_item' | 'spam' | 'off_platform_transaction' | 'other';

export interface CreateReportPayload {
  reportType: ReportType;
  targetId: string;
  reason: ReportReason;
  description?: string;
}

@Injectable({ providedIn: 'root' })
export class ReportService {
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/reports`;

  createReport(payload: CreateReportPayload): Observable<{ message: string; reportId: string }> {
    return this.http.post<{ message: string; reportId: string }>(this.apiUrl, payload);
  }
}
