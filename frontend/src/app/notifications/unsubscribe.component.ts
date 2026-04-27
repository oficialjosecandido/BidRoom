import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { API_CONFIG } from '../shared/config/api.config';

@Component({
  selector: 'app-unsubscribe',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="unsubscribe-page">
      <div class="unsubscribe-card">
        @if (loading) {
          <div class="state-icon">⏳</div>
          <h1>Processing…</h1>
          <p>Please wait while we update your preferences.</p>
        } @else if (success) {
          <div class="state-icon">✅</div>
          <h1>Unsubscribed</h1>
          <p>You have been unsubscribed from all BidRoom email notifications. You can re-enable emails anytime from <a routerLink="/dashboard/settings">Account Settings</a>.</p>
        } @else {
          <div class="state-icon">❌</div>
          <h1>Invalid link</h1>
          <p>{{ errorMessage }}</p>
          <a routerLink="/landing" class="home-link">Go to homepage</a>
        }
      </div>
    </div>
  `,
  styles: [`
    .unsubscribe-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f7f7f7;
      padding: 24px;
    }
    .unsubscribe-card {
      background: #fff;
      border-radius: 12px;
      padding: 48px 40px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .state-icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 24px; font-weight: 700; margin: 0 0 12px; color: #1a1a1a; }
    p { color: #555; line-height: 1.6; margin: 0 0 20px; }
    a { color: var(--primary-color, #1565c0); text-decoration: underline; }
    .home-link { display: inline-block; margin-top: 8px; }
  `]
})
export class UnsubscribeComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private apiUrl = API_CONFIG.getApiUrl();

  loading = true;
  success = false;
  errorMessage = 'This unsubscribe link is invalid or has already been used.';

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.loading = false;
      return;
    }
    this.http.get<{ success: boolean }>(`${this.apiUrl}/notifications/unsubscribe`, { params: { token } }).subscribe({
      next: () => { this.loading = false; this.success = true; },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err?.error?.error || 'This unsubscribe link is invalid or has already been used.';
      }
    });
  }
}
