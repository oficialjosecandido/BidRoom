import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { API_CONFIG } from '../config/api.config';
import Swal from 'sweetalert2';

export type KycStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface KycStatusResponse {
  kycStatus: KycStatus;
  kycVerifiedAt: string | null;
  kycRejectionReason: string | null;
  kycSubmittedAt: string | null;
}

export const KYC_THRESHOLD = 5000;

@Injectable({ providedIn: 'root' })
export class KycService {
  private http = inject(HttpClient);
  private translate = inject(TranslateService);
  private apiUrl = `${API_CONFIG.getApiUrl()}/kyc`;

  private kycStatusSubject = new BehaviorSubject<KycStatus>('none');
  readonly kycStatus$ = this.kycStatusSubject.asObservable();

  get kycStatus(): KycStatus { return this.kycStatusSubject.value; }

  fetchStatus(): Observable<KycStatusResponse> {
    return this.http.get<KycStatusResponse>(`${this.apiUrl}/status`).pipe(
      tap(res => this.kycStatusSubject.next(res.kycStatus))
    );
  }

  createSession(): Observable<{ url: string; sessionId: string }> {
    return this.http.post<{ url: string; sessionId: string }>(`${this.apiUrl}/session`, {});
  }

  /** Redirect user to Stripe Identity verification. */
  startVerification(): void {
    this.createSession().subscribe({
      next: (res) => {
        window.location.href = res.url;
      },
      error: (err) => {
        Swal.fire({
          icon: 'error',
          title: this.translate.instant('dashboard.settings.kycUnavailableTitle'),
          text: err?.error?.message || this.translate.instant('dashboard.settings.kycUnavailableText'),
          confirmButtonColor: '#7A4F84'
        });
      }
    });
  }

  /**
   * Show the KYC gate dialog when a high-value action is blocked.
   * @param kycStatus current KYC status received in the 403 error
   */
  openKycGate(kycStatus: KycStatus = 'none'): void {
    if (kycStatus === 'pending') {
      Swal.fire({
        icon: 'info',
        title: this.translate.instant('dashboard.settings.kycPendingTitle'),
        html: `<p style="color:#374151;font-size:0.95rem;line-height:1.5">${this.translate.instant('dashboard.settings.kycPending')}</p>`,
        confirmButtonText: this.translate.instant('dashboard.settings.kycOk'),
        confirmButtonColor: '#7A4F84'
      });
      return;
    }

    if (kycStatus === 'rejected') {
      Swal.fire({
        icon: 'warning',
        title: this.translate.instant('dashboard.settings.kycRejectedTitle'),
        html: `
          <p style="color:#374151;font-size:0.95rem;line-height:1.5">
            ${this.translate.instant('dashboard.settings.kycRejectedBase')}<br><br>
            ${this.translate.instant('dashboard.settings.kycRejectedTryAgain')}
          </p>`,
        showCancelButton: true,
        confirmButtonText: this.translate.instant('dashboard.settings.kycTryAgain'),
        cancelButtonText: this.translate.instant('dashboard.settings.cancelBtn'),
        confirmButtonColor: '#7A4F84'
      }).then(result => {
        if (result.isConfirmed) this.startVerification();
      });
      return;
    }

    const threshold = this.translate.instant('dashboard.settings.kycThresholdAmount');
    Swal.fire({
      title: this.translate.instant('dashboard.settings.kycGateTitle'),
      html: `
        <div style="text-align:left;padding:4px 0">
          <p style="color:#374151;font-size:0.9rem;line-height:1.5;margin:0 0 12px">
            ${this.translate.instant('dashboard.settings.kycAmlDesc', { threshold })}
          </p>
          <p style="color:#374151;font-size:0.9rem;line-height:1.5;margin:0 0 8px">
            ${this.translate.instant('dashboard.settings.kycYouWillNeed')}
          </p>
          <ul style="color:#374151;font-size:0.9rem;line-height:1.7;padding-left:18px;margin:0 0 12px">
            <li>${this.translate.instant('dashboard.settings.kycDoc1')}</li>
            <li>${this.translate.instant('dashboard.settings.kycDoc2')}</li>
          </ul>
          <p style="color:#6b7280;font-size:0.82rem;margin:0">
            ${this.translate.instant('dashboard.settings.kycDoc3')}
          </p>
        </div>`,
      showCancelButton: true,
      confirmButtonText: this.translate.instant('dashboard.settings.kycStart'),
      cancelButtonText: this.translate.instant('dashboard.settings.kycNotNow'),
      confirmButtonColor: '#7A4F84',
      width: 480
    }).then(result => {
      if (result.isConfirmed) this.startVerification();
    });
  }
}
