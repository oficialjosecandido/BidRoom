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
      <div class="prefs-shell">
        <a routerLink="/" class="prefs-brand" aria-label="BidRoom">
          <span class="prefs-wordmark">BidRoom</span><span class="prefs-pt">.pt</span>
        </a>

        <div class="prefs-card">
          @if (loading) {
            <div class="prefs-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="9" opacity="0.25"/>
                <path d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round"/>
              </svg>
            </div>
            <h1>A carregar…</h1>
            <p class="intro">A preparar as suas preferências.</p>
          } @else if (needsEmail) {
            <div class="prefs-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="5" width="18" height="14" rx="2"/>
                <path d="M3 7l9 7 9-7"/>
              </svg>
            </div>
            <h1>Preferências de email</h1>
            <p class="intro">Confirme o seu email para gerir a newsletter, o idioma ou cancelar a subscrição.</p>

            <form class="email-form" (ngSubmit)="lookupByEmail()">
              <div class="field">
                <label for="prefs-email">Email</label>
                <input
                  id="prefs-email"
                  type="email"
                  class="input"
                  [(ngModel)]="emailInput"
                  name="email"
                  autocomplete="email"
                  placeholder="nome@email.com"
                  required />
              </div>
              <div class="field">
                <label for="prefs-email-confirm">Repetir email</label>
                <input
                  id="prefs-email-confirm"
                  type="email"
                  class="input"
                  [(ngModel)]="emailConfirmInput"
                  name="emailConfirm"
                  autocomplete="email"
                  placeholder="Confirme o mesmo email"
                  required />
              </div>
              @if (lookupError) {
                <p class="save-message error" role="alert">{{ lookupError }}</p>
              }
              <button
                type="submit"
                class="btn btn-primary"
                [disabled]="lookingUp || !emailInput.trim() || !emailConfirmInput.trim()">
                {{ lookingUp ? 'A verificar…' : 'Continuar' }}
              </button>
            </form>
          } @else if (invalid) {
            <div class="prefs-icon prefs-icon--warn" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="9"/>
                <path d="M12 8v5" stroke-linecap="round"/>
                <circle cx="12" cy="16" r="0.8" fill="currentColor"/>
              </svg>
            </div>
            <h1>Link inválido</h1>
            <p class="intro">{{ errorMessage }}</p>
            <button type="button" class="btn btn-primary" (click)="showEmailForm()">Usar o meu email</button>
            <a routerLink="/" class="home-link">Voltar à BidRoom</a>
          } @else {
            <div class="prefs-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="5" width="18" height="14" rx="2"/>
                <path d="M3 7l9 7 9-7"/>
              </svg>
            </div>
            <h1>Preferências de email</h1>
            <p class="email-line">{{ email }}</p>

            <div class="section">
              <label id="lang-label">Idioma preferido</label>
              <div class="lang-options" role="group" aria-labelledby="lang-label">
                @for (lang of languages; track lang) {
                  <button
                    type="button"
                    class="lang-btn"
                    [class.active]="language === lang"
                    [disabled]="saving"
                    (click)="saveLanguage(lang)">
                    {{ languageLabels[lang] }}
                  </button>
                }
              </div>
            </div>

            <div class="section">
              <label>Subscrição</label>
              @if (unsubscribed) {
                <div class="status-card status-card--off">
                  <p class="status-text">Cancelou a subscrição dos emails BidRoom.</p>
                  <button type="button" class="btn btn-secondary" [disabled]="saving" (click)="resubscribe()">
                    Voltar a subscrever
                  </button>
                </div>
              } @else {
                <div class="status-card status-card--on">
                  <p class="status-text">Está subscrito aos emails BidRoom.</p>
                  <button type="button" class="btn btn-danger" [disabled]="saving" (click)="unsubscribe()">
                    Cancelar subscrição
                  </button>
                </div>
              }
            </div>

            @if (saveMessage) {
              <p class="save-message success" role="status">{{ saveMessage }}</p>
            }
            @if (saveError) {
              <p class="save-message error" role="alert">{{ saveError }}</p>
            }
          }
        </div>

        <p class="prefs-footnote">
          Leilões premium · <a routerLink="/">www.bidroom.pt</a>
        </p>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      --ep-gold: #C9A84C;
      --ep-gold-dark: #a8872e;
      --ep-ink: #0f172a;
      --ep-text: #334155;
      --ep-muted: #64748b;
      --ep-line: #e8d9a8;
      --ep-card: #ffffff;
    }

    .prefs-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 20px;
      background:
        radial-gradient(ellipse 80% 50% at 50% -10%, rgba(201, 168, 76, 0.18), transparent 55%),
        radial-gradient(ellipse 60% 40% at 100% 100%, rgba(201, 168, 76, 0.08), transparent 50%),
        #111111;
      color-scheme: light;
    }

    .prefs-shell {
      width: 100%;
      max-width: 440px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
    }

    .prefs-brand {
      display: inline-flex;
      align-items: baseline;
      gap: 1px;
      text-decoration: none;
      padding: 4px 0;
    }

    .prefs-wordmark {
      color: var(--ep-gold);
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .prefs-pt {
      color: rgba(240, 237, 232, 0.55);
      font-size: 0.95rem;
      font-weight: 600;
    }

    .prefs-card {
      background: var(--ep-card);
      border-radius: 16px;
      padding: 36px 32px 32px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.35);
      border-top: 3px solid var(--ep-gold);
      box-sizing: border-box;
    }

    .prefs-icon {
      width: 48px;
      height: 48px;
      margin: 0 auto 16px;
      border-radius: 50%;
      background: #faf6eb;
      border: 1px solid var(--ep-line);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--ep-gold-dark);

      svg { width: 22px; height: 22px; }

      &--warn {
        background: #fff7ed;
        border-color: #fed7aa;
        color: #c2410c;
      }
    }

    h1 {
      font-size: 1.35rem;
      font-weight: 700;
      margin: 0 0 8px;
      color: var(--ep-ink);
      letter-spacing: -0.02em;
      line-height: 1.25;
    }

    .intro {
      color: var(--ep-muted);
      font-size: 0.9rem;
      margin: 0 0 24px;
      line-height: 1.55;
    }

    .email-line {
      display: inline-block;
      margin: 0 0 8px;
      padding: 6px 12px;
      border-radius: 999px;
      background: #faf6eb;
      border: 1px solid var(--ep-line);
      color: var(--ep-text);
      font-size: 0.85rem;
      font-weight: 600;
      word-break: break-all;
    }

    .email-form {
      text-align: left;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .field label {
      display: block;
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--ep-text);
      margin-bottom: 6px;
      letter-spacing: 0.01em;
    }

    .input {
      width: 100%;
      box-sizing: border-box;
      padding: 12px 14px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      font-size: 0.95rem;
      font-family: inherit;
      color: var(--ep-ink) !important;
      background: #ffffff !important;
      color-scheme: light;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;

      &::placeholder { color: #94a3b8; }

      &:hover { border-color: #cbd5e1; }

      &:focus {
        outline: none;
        border-color: var(--ep-gold);
        box-shadow: 0 0 0 3px rgba(201, 168, 76, 0.2);
      }
    }

    .section {
      text-align: left;
      margin-top: 22px;
      padding-top: 22px;
      border-top: 1px solid #f1f5f9;

      > label {
        display: block;
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--ep-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 12px;
      }
    }

    .lang-options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .lang-btn {
      padding: 10px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #fff;
      color: var(--ep-text);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;

      &:hover:not(:disabled):not(.active) {
        border-color: var(--ep-gold);
        color: var(--ep-ink);
      }

      &.active {
        background: #111111;
        border-color: #111111;
        color: var(--ep-gold);
      }

      &:disabled { opacity: 0.55; cursor: not-allowed; }
    }

    .status-card {
      border-radius: 12px;
      padding: 14px 16px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;

      &--on {
        background: #faf6eb;
        border-color: var(--ep-line);
      }

      &--off {
        background: #fff7ed;
        border-color: #fed7aa;
      }
    }

    .status-text {
      font-size: 0.9rem;
      color: var(--ep-text);
      margin: 0 0 12px;
      line-height: 1.45;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 12px 18px;
      border: none;
      border-radius: 999px;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      font-family: inherit;
      letter-spacing: 0.01em;
      transition: transform 0.12s ease, opacity 0.12s ease, background 0.15s ease;

      &:disabled { opacity: 0.55; cursor: not-allowed; }
      &:not(:disabled):active { transform: scale(0.98); }
    }

    .btn-primary {
      width: 100%;
      background: var(--ep-gold);
      color: #090909;

      &:hover:not(:disabled) { background: #d4b45a; }
    }

    .btn-secondary {
      background: #111111;
      color: var(--ep-gold);

      &:hover:not(:disabled) { background: #1a1a1a; }
    }

    .btn-danger {
      background: transparent;
      color: #b91c1c;
      border: 1px solid #fecaca;
      border-radius: 999px;

      &:hover:not(:disabled) {
        background: #fef2f2;
        border-color: #f87171;
      }
    }

    .home-link {
      display: inline-block;
      margin-top: 16px;
      color: var(--ep-gold-dark);
      font-size: 0.85rem;
      font-weight: 600;
      text-decoration: none;

      &:hover { text-decoration: underline; }
    }

    .save-message {
      margin: 4px 0 0;
      font-size: 0.85rem;
      font-weight: 600;
      text-align: left;
    }
    .save-message.success { color: #166534; }
    .save-message.error { color: #c53030; }

    .prefs-footnote {
      margin: 0;
      font-size: 0.75rem;
      color: rgba(240, 237, 232, 0.45);
      text-align: center;

      a {
        color: var(--ep-gold);
        text-decoration: none;
        &:hover { text-decoration: underline; }
      }
    }

    @media (max-width: 480px) {
      .prefs-card { padding: 28px 22px 24px; }
    }
  `]
})
export class EmailPreferencesComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private apiUrl = API_CONFIG.getApiUrl();

  readonly languages: Language[] = ['pt', 'en', 'fr', 'es'];
  readonly languageLabels = LANGUAGE_LABELS;

  loading = true;
  needsEmail = false;
  invalid = false;
  errorMessage = 'Este link é inválido ou expirou.';

  private token: string | null = null;
  private type: string | null = null;
  email = '';
  language: Language = 'en';
  unsubscribed = false;

  emailInput = '';
  emailConfirmInput = '';
  lookingUp = false;
  lookupError: string | null = null;

  saving = false;
  saveMessage: string | null = null;
  saveError: string | null = null;

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token');
    this.type = this.route.snapshot.queryParamMap.get('type');
    if (!this.token || !this.type) {
      this.loading = false;
      this.needsEmail = true;
      return;
    }
    this.http.get<{ email: string; language: Language; unsubscribed: boolean; type?: string }>(`${this.apiUrl}/email-preferences`, {
      params: { token: this.token, type: this.type }
    }).subscribe({
      next: (res) => {
        this.loading = false;
        this.applyPrefs(res);
      },
      error: (err) => {
        this.loading = false;
        this.invalid = true;
        this.errorMessage = err?.error?.error || this.errorMessage;
      }
    });
  }

  showEmailForm(): void {
    this.invalid = false;
    this.needsEmail = true;
    this.token = null;
    this.type = null;
  }

  lookupByEmail(): void {
    if (this.lookingUp) return;
    const email = this.emailInput.trim().toLowerCase();
    const emailConfirm = this.emailConfirmInput.trim().toLowerCase();
    this.lookupError = null;

    if (!email || !email.includes('@')) {
      this.lookupError = 'Introduza um email válido.';
      return;
    }
    if (email !== emailConfirm) {
      this.lookupError = 'Os emails não coincidem.';
      return;
    }

    this.lookingUp = true;
    this.http.post<{ email: string; language: Language; unsubscribed: boolean; type: string }>(
      `${this.apiUrl}/email-preferences/lookup`,
      { email, emailConfirm }
    ).subscribe({
      next: (res) => {
        this.lookingUp = false;
        this.needsEmail = false;
        this.applyPrefs(res);
      },
      error: (err) => {
        this.lookingUp = false;
        this.lookupError = err?.error?.error || 'Não foi possível carregar as preferências.';
      }
    });
  }

  private applyPrefs(res: { email: string; language: Language; unsubscribed: boolean; type?: string }): void {
    this.email = res.email;
    this.language = res.language;
    this.unsubscribed = res.unsubscribed;
    if (res.type) this.type = res.type;
    this.emailInput = res.email;
    this.emailConfirmInput = res.email;
  }

  private authBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
    if (this.token && this.type) {
      return { token: this.token, type: this.type, ...extra };
    }
    return {
      email: this.emailInput.trim().toLowerCase() || this.email,
      emailConfirm: this.emailConfirmInput.trim().toLowerCase() || this.email,
      ...extra
    };
  }

  saveLanguage(language: Language): void {
    if (this.saving || language === this.language) return;
    const previous = this.language;
    this.language = language;
    this.saving = true;
    this.saveMessage = null;
    this.saveError = null;
    this.http.post<{ ok: boolean }>(`${this.apiUrl}/email-preferences/language`, this.authBody({ language })).subscribe({
      next: () => { this.saving = false; this.saveMessage = 'Idioma atualizado.'; },
      error: (err) => {
        this.saving = false;
        this.language = previous;
        this.saveError = err?.error?.error || 'Falha ao atualizar o idioma.';
      }
    });
  }

  unsubscribe(): void {
    if (this.saving) return;
    this.saving = true;
    this.saveError = null;
    this.http.post<{ ok: boolean }>(`${this.apiUrl}/email-preferences/unsubscribe`, this.authBody()).subscribe({
      next: () => { this.saving = false; this.unsubscribed = true; this.saveMessage = 'Subscrição cancelada.'; },
      error: (err) => {
        this.saving = false;
        this.saveError = err?.error?.error || 'Falha ao cancelar a subscrição.';
      }
    });
  }

  resubscribe(): void {
    if (this.saving) return;
    this.saving = true;
    this.saveError = null;
    this.http.post<{ ok: boolean }>(`${this.apiUrl}/email-preferences/resubscribe`, this.authBody()).subscribe({
      next: () => { this.saving = false; this.unsubscribed = false; this.saveMessage = 'Voltou a subscrever.'; },
      error: (err) => {
        this.saving = false;
        this.saveError = err?.error?.error || 'Falha ao voltar a subscrever.';
      }
    });
  }
}
