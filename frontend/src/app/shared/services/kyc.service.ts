import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { API_CONFIG } from '../config/api.config';

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

  /** SweetAlert2 is only needed when a KYC dialog opens — keep it off the listing LCP path. */
  private async swal() {
    return (await import('sweetalert2')).default;
  }

  /** Redirect user to Stripe Identity verification. */
  startVerification(): void {
    this.createSession().subscribe({
      next: (res) => {
        window.location.href = res.url;
      },
      error: async (err) => {
        const Swal = await this.swal();
        Swal.fire({
          icon: 'error',
          title: this.translate.instant('dashboard.myAccount.kycUnavailableTitle'),
          text: err?.error?.message || this.translate.instant('dashboard.myAccount.kycUnavailableText'),
          confirmButtonColor: '#7A4F84'
        });
      }
    });
  }

  /**
   * Show the KYC gate dialog when a high-value action is blocked.
   * @param kycStatus current KYC status received in the 403 error
   */
  async openKycGate(kycStatus: KycStatus = 'none'): Promise<void> {
    const Swal = await this.swal();

    if (kycStatus === 'pending') {
      await Swal.fire({
        icon: 'info',
        title: this.translate.instant('dashboard.myAccount.kycPendingTitle'),
        html: `<p style="color:#374151;font-size:0.95rem;line-height:1.5">${this.translate.instant('dashboard.myAccount.kycPending')}</p>`,
        confirmButtonText: this.translate.instant('dashboard.myAccount.kycOk'),
        confirmButtonColor: '#7A4F84'
      });
      return;
    }

    if (kycStatus === 'rejected') {
      const result = await Swal.fire({
        icon: 'warning',
        title: this.translate.instant('dashboard.myAccount.kycRejectedTitle'),
        html: `
          <p style="color:#374151;font-size:0.95rem;line-height:1.5">
            ${this.translate.instant('dashboard.myAccount.kycRejectedBase')}<br><br>
            ${this.translate.instant('dashboard.myAccount.kycRejectedTryAgain')}
          </p>`,
        showCancelButton: true,
        confirmButtonText: this.translate.instant('dashboard.myAccount.kycTryAgain'),
        cancelButtonText: this.translate.instant('dashboard.settings.cancelBtn'),
        confirmButtonColor: '#7A4F84'
      });
      if (result.isConfirmed) this.startVerification();
      return;
    }

    const threshold = this.translate.instant('dashboard.myAccount.kycThresholdAmount');
    const result = await Swal.fire({
      title: this.translate.instant('dashboard.myAccount.kycGateTitle'),
      html: `
        <div style="text-align:left;padding:4px 0">
          <p style="color:#374151;font-size:0.9rem;line-height:1.5;margin:0 0 12px">
            ${this.translate.instant('dashboard.myAccount.kycAmlDesc', { threshold })}
          </p>
          <p style="color:#374151;font-size:0.9rem;line-height:1.5;margin:0 0 8px">
            ${this.translate.instant('dashboard.myAccount.kycYouWillNeed')}
          </p>
          <ul style="color:#374151;font-size:0.9rem;line-height:1.7;padding-left:18px;margin:0 0 12px">
            <li>${this.translate.instant('dashboard.myAccount.kycDoc1')}</li>
            <li>${this.translate.instant('dashboard.myAccount.kycDoc2')}</li>
          </ul>
          <p style="color:#6b7280;font-size:0.82rem;margin:0">
            ${this.translate.instant('dashboard.myAccount.kycDoc3')}
          </p>
        </div>`,
      showCancelButton: true,
      confirmButtonText: this.translate.instant('dashboard.myAccount.kycStart'),
      cancelButtonText: this.translate.instant('dashboard.myAccount.kycNotNow'),
      confirmButtonColor: '#7A4F84',
      width: 480
    });
    if (result.isConfirmed) this.startVerification();
  }
}
