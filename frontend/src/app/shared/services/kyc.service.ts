import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
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
          title: 'Verification unavailable',
          text: err?.error?.message || 'Could not start identity verification. Please try again later.',
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
        title: 'Verification in progress',
        html: `
          <p style="color:#374151;font-size:0.95rem;line-height:1.5">
            Your identity is being verified. This usually takes a few minutes.<br><br>
            You will be able to proceed once the verification is approved.
          </p>`,
        confirmButtonText: 'OK',
        confirmButtonColor: '#7A4F84'
      });
      return;
    }

    if (kycStatus === 'rejected') {
      Swal.fire({
        icon: 'warning',
        title: 'Verification not approved',
        html: `
          <p style="color:#374151;font-size:0.95rem;line-height:1.5">
            Your previous identity verification was not approved.<br><br>
            Please try again with a valid government-issued ID and a clear selfie.
          </p>`,
        showCancelButton: true,
        confirmButtonText: 'Try Again',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#7A4F84'
      }).then(result => {
        if (result.isConfirmed) this.startVerification();
      });
      return;
    }

    // kycStatus === 'none' or default
    Swal.fire({
      title: 'Identity Verification Required',
      html: `
        <div style="text-align:left;padding:4px 0">
          <p style="color:#374151;font-size:0.9rem;line-height:1.5;margin:0 0 12px">
            Transactions of <strong>$${KYC_THRESHOLD.toLocaleString()} or more</strong> require identity verification to comply with anti-money laundering (AML) regulations.
          </p>
          <p style="color:#374151;font-size:0.9rem;line-height:1.5;margin:0 0 12px">
            You will need:
          </p>
          <ul style="color:#374151;font-size:0.9rem;line-height:1.7;padding-left:18px;margin:0 0 12px">
            <li>A government-issued photo ID (passport, driver's licence, or national ID)</li>
            <li>A selfie (live photo — liveness check required)</li>
          </ul>
          <p style="color:#6b7280;font-size:0.82rem;margin:0">
            Verification is handled securely by Stripe Identity. Your data is not stored on BidRoom.
          </p>
        </div>`,
      showCancelButton: true,
      confirmButtonText: 'Start Verification',
      cancelButtonText: 'Not now',
      confirmButtonColor: '#7A4F84',
      width: 480
    }).then(result => {
      if (result.isConfirmed) this.startVerification();
    });
  }
}
