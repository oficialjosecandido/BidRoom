import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { API_CONFIG } from '../shared/config/api.config';

type Language = 'pt' | 'en' | 'es' | 'fr';

const LANGUAGE_LABELS: Record<Language, string> = {
  pt: 'Português',
  en: 'English',
  fr: 'Français',
  es: 'Español'
};

@Component({
  selector: 'app-email-preferences',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="prefs-page">
      <div class="prefs-card">
        @if (loading) {
          <div class="state-icon">⏳</div>
          <h1>Loading…</h1>
        } @else if (invalid) {
          <div class="state-icon">❌</div>
          <h1>Invalid link</h1>
          <p>{{ errorMessage }}</p>
          <a routerLink="/landing" class="home-link">Go to homepage</a>
        } @else {
          <div class="state-icon">✉️</div>
          <h1>Email preferences</h1>
          <p class="email-line">{{ email }}</p>

          <div class="section">
            <label>Preferred language</label>
            <div class="lang-options">
              @for (lang of languages; track lang) {
                <button type="button" class="lang-btn" [class.active]="language === lang" [disabled]="saving" (click)="saveLanguage(lang)">
                  {{ languageLabels[lang] }}
                </button>
              }
            </div>
          </div>

          <div class="section">
            <label>Subscription</label>
            @if (unsubscribed) {
              <p class="status-text">You are unsubscribed from BidRoom emails.</p>
              <button type="button" class="btn btn-secondary" [disabled]="saving" (click)="resubscribe()">Resubscribe</button>
            } @else {
              <p class="status-text">You are currently subscribed.</p>
              <button type="button" class="btn btn-danger" [disabled]="saving" (click)="unsubscribe()">Unsubscribe from all emails</button>
            }
          </div>

          @if (saveMessage) { <p class="save-message success">{{ saveMessage }}</p> }
          @if (saveError) { <p class="save-message error">{{ saveError }}</p> }
        }
      </div>
    </div>
  `,
  styles: [`
    .prefs-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f7f7f7;
      padding: 24px;
    }
    .prefs-card {
      background: #fff;
      border-radius: 12px;
      padding: 48px 40px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .state-icon { font-size: 40px; margin-bottom: 12px; }
    h1 { font-size: 22px; font-weight: 700; margin: 0 0 8px; color: #1a1a1a; }
    .email-line { color: #64748b; font-size: 14px; margin: 0 0 24px; }
    p { color: #555; line-height: 1.6; margin: 0 0 16px; }
    a { color: var(--primary-color, #1565c0); text-decoration: underline; }
    .home-link { display: inline-block; margin-top: 8px; }

    .section {
      text-align: left;
      margin-bottom: 24px;
      padding-top: 20px;
      border-top: 1px solid #eee;

      label { display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 10px; }
    }

    .lang-options { display: flex; gap: 8px; flex-wrap: wrap; }
    .lang-btn {
      padding: 8px 14px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #fff;
      color: #475569;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;

      &.active { background: var(--primary-color, #1565c0); border-color: var(--primary-color, #1565c0); color: #fff; }
      &:disabled { opacity: 0.6; cursor: not-allowed; }
    }

    .status-text { font-size: 14px; margin-bottom: 12px; }

    .btn {
      padding: 10px 18px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      &:disabled { opacity: 0.6; cursor: not-allowed; }
    }
    .btn-danger { background: #fee2e2; color: #b91c1c; }
    .btn-secondary { background: #e2e8f0; color: #334155; }

    .save-message { margin: 0; font-size: 13px; font-weight: 600; }
    .save-message.success { color: #166534; }
    .save-message.error { color: #c53030; }
  `]
})
export class EmailPreferencesComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private apiUrl = API_CONFIG.getApiUrl();

  readonly languages: Language[] = ['pt', 'en', 'fr', 'es'];
  readonly languageLabels = LANGUAGE_LABELS;

  loading = true;
  invalid = false;
  errorMessage = 'This link is invalid or has expired.';

  private token: string | null = null;
  private type: string | null = null;
  email = '';
  language: Language = 'en';
  unsubscribed = false;

  saving = false;
  saveMessage: string | null = null;
  saveError: string | null = null;

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token');
    this.type = this.route.snapshot.queryParamMap.get('type');
    if (!this.token || !this.type) {
      this.loading = false;
      this.invalid = true;
      return;
    }
    this.http.get<{ email: string; language: Language; unsubscribed: boolean }>(`${this.apiUrl}/email-preferences`, {
      params: { token: this.token, type: this.type }
    }).subscribe({
      next: (res) => {
        this.loading = false;
        this.email = res.email;
        this.language = res.language;
        this.unsubscribed = res.unsubscribed;
      },
      error: (err) => {
        this.loading = false;
        this.invalid = true;
        this.errorMessage = err?.error?.error || this.errorMessage;
      }
    });
  }

  saveLanguage(language: Language): void {
    if (this.saving || language === this.language) return;
    const previous = this.language;
    this.language = language;
    this.saving = true;
    this.saveMessage = null;
    this.saveError = null;
    this.http.post<{ ok: boolean }>(`${this.apiUrl}/email-preferences/language`, {
      token: this.token, type: this.type, language
    }).subscribe({
      next: () => { this.saving = false; this.saveMessage = 'Language updated.'; },
      error: (err) => {
        this.saving = false;
        this.language = previous;
        this.saveError = err?.error?.error || 'Failed to update language.';
      }
    });
  }

  unsubscribe(): void {
    if (this.saving) return;
    this.saving = true;
    this.saveError = null;
    this.http.post<{ ok: boolean }>(`${this.apiUrl}/email-preferences/unsubscribe`, {
      token: this.token, type: this.type
    }).subscribe({
      next: () => { this.saving = false; this.unsubscribed = true; this.saveMessage = 'You have been unsubscribed.'; },
      error: (err) => {
        this.saving = false;
        this.saveError = err?.error?.error || 'Failed to unsubscribe.';
      }
    });
  }

  resubscribe(): void {
    if (this.saving) return;
    this.saving = true;
    this.saveError = null;
    this.http.post<{ ok: boolean }>(`${this.apiUrl}/email-preferences/resubscribe`, {
      token: this.token, type: this.type
    }).subscribe({
      next: () => { this.saving = false; this.unsubscribed = false; this.saveMessage = 'You have been resubscribed.'; },
      error: (err) => {
        this.saving = false;
        this.saveError = err?.error?.error || 'Failed to resubscribe.';
      }
    });
  }
}
