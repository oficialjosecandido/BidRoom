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

const LANGUAGE_FLAGS: Record<Language, string> = {
  pt: 'PT',
  en: 'EN',
  fr: 'FR',
  es: 'ES'
};

@Component({
  selector: 'app-email-preferences',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="prefs-page">
      <div class="prefs-glow" aria-hidden="true"></div>
      <div class="prefs-shell">
        <a routerLink="/" class="prefs-brand" aria-label="BidRoom">
          <span class="prefs-wordmark">BidRoom</span><span class="prefs-pt">.pt</span>
        </a>

        <div class="prefs-card" [class.prefs-card--manage]="!loading && !needsEmail && !invalid">
          @if (loading) {
            <div class="prefs-icon prefs-icon--spin" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                <circle cx="12" cy="12" r="9" opacity="0.2"/>
                <path d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round"/>
              </svg>
            </div>
            <p class="eyebrow">BidRoom</p>
            <h1>A carregar</h1>
            <p class="intro">A preparar as suas preferências de email.</p>
          } @else if (needsEmail) {
            <p class="eyebrow">Gestão de emails</p>
            <h1>Preferências de email</h1>
            <p class="intro">Introduza o email da sua conta para gerir a newsletter, o idioma ou a subscrição.</p>

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
                <label for="prefs-email-confirm">Confirmar email</label>
                <input
                  id="prefs-email-confirm"
                  type="email"
                  class="input"
                  [(ngModel)]="emailConfirmInput"
                  name="emailConfirm"
                  autocomplete="email"
                  placeholder="Repita o mesmo email"
                  required />
              </div>
              @if (lookupError) {
                <p class="banner banner--error" role="alert">{{ lookupError }}</p>
              }
              <button
                type="submit"
                class="btn btn-primary"
                [disabled]="lookingUp || !emailInput.trim() || !emailConfirmInput.trim()">
                {{ lookingUp ? 'A verificar…' : 'Continuar' }}
              </button>
            </form>
            <p class="secure-note">Usamos o email só para confirmar a sua identidade — não enviamos spam.</p>
          } @else if (invalid) {
            <div class="prefs-icon prefs-icon--warn" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                <circle cx="12" cy="12" r="9"/>
                <path d="M12 8v5" stroke-linecap="round"/>
                <circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none"/>
              </svg>
            </div>
            <p class="eyebrow eyebrow--warn">Atenção</p>
            <h1>Link inválido</h1>
            <p class="intro">{{ errorMessage }}</p>
            <button type="button" class="btn btn-primary" (click)="showEmailForm()">Usar o meu email</button>
            <a routerLink="/" class="home-link">Voltar à BidRoom</a>
          } @else {
            <p class="eyebrow">A sua conta</p>
            <h1>Preferências de email</h1>
            <div class="account-pill">
              <span class="account-dot" aria-hidden="true"></span>
              <span>{{ email }}</span>
            </div>

            <section class="panel">
              <header class="panel-head">
                <h2>Idioma dos emails</h2>
                <p>Os emails BidRoom chegam neste idioma.</p>
              </header>
              <div class="lang-options" role="group" aria-label="Idioma preferido">
                @for (lang of languages; track lang) {
                  <button
                    type="button"
                    class="lang-btn"
                    [class.active]="language === lang"
                    [disabled]="saving"
                    (click)="saveLanguage(lang)">
                    <span class="lang-code">{{ languageFlags[lang] }}</span>
                    <span class="lang-name">{{ languageLabels[lang] }}</span>
                  </button>
                }
              </div>
            </section>

            <section class="panel">
              <header class="panel-head">
                <h2>Newsletter</h2>
                <p>Novos leilões, passatempos e novidades BidRoom.</p>
              </header>
              @if (unsubscribed) {
                <div class="status status--off">
                  <div class="status-copy">
                    <strong>Subscrição cancelada</strong>
                    <span>Já não recebe emails de marketing da BidRoom.</span>
                  </div>
                  <button type="button" class="btn btn-secondary" [disabled]="saving" (click)="resubscribe()">
                    Voltar a subscrever
                  </button>
                </div>
              } @else {
                <div class="status status--on">
                  <div class="status-copy">
                    <strong>Subscrito</strong>
                    <span>Recebe a newsletter BidRoom neste email.</span>
                  </div>
                  <button type="button" class="btn btn-ghost" [disabled]="saving" (click)="unsubscribe()">
                    Cancelar subscrição
                  </button>
                </div>
              }
            </section>

            @if (saveMessage) {
              <p class="banner banner--ok" role="status">{{ saveMessage }}</p>
            }
            @if (saveError) {
              <p class="banner banner--error" role="alert">{{ saveError }}</p>
            }

            <a routerLink="/" class="home-link">Ir para a BidRoom</a>
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
      --ep-gold-soft: #d4b45a;
      --ep-gold-dark: #a8872e;
      --ep-ink: #111111;
      --ep-text: #3a3a3a;
      --ep-muted: #6b6b6b;
      --ep-cream: #faf6eb;
      --ep-line: #e8d9a8;
      --ep-card: #ffffff;
      --ep-border: rgba(17, 17, 17, 0.1);
      font-family: 'DM Sans', system-ui, sans-serif;
    }

    .prefs-page {
      position: relative;
      isolation: isolate;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      overflow: hidden;
      background: #0c0c0c;
      color-scheme: light;
    }

    .prefs-glow {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        radial-gradient(ellipse 70% 45% at 50% -5%, rgba(201, 168, 76, 0.22), transparent 60%),
        radial-gradient(ellipse 50% 35% at 85% 90%, rgba(201, 168, 76, 0.1), transparent 55%),
        radial-gradient(ellipse 40% 30% at 10% 80%, rgba(240, 237, 232, 0.04), transparent 50%);
    }

    .prefs-shell {
      position: relative;
      width: 100%;
      max-width: 460px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 22px;
    }

    .prefs-brand {
      display: inline-flex;
      align-items: baseline;
      text-decoration: none;
      letter-spacing: -0.03em;
    }

    .prefs-wordmark {
      color: var(--ep-gold);
      font-size: 1.55rem;
      font-weight: 700;
    }

    .prefs-pt {
      color: rgba(240, 237, 232, 0.5);
      font-size: 1.05rem;
      font-weight: 600;
    }

    .prefs-card {
      width: 100%;
      box-sizing: border-box;
      background: var(--ep-card);
      border-radius: 20px;
      padding: 36px 32px 28px;
      text-align: center;
      box-shadow:
        0 0 0 1px rgba(201, 168, 76, 0.12),
        0 24px 60px rgba(0, 0, 0, 0.45);
      position: relative;
      overflow: hidden;

      &::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, transparent, var(--ep-gold), transparent);
      }
    }

    .prefs-card--manage {
      text-align: left;
    }

    .prefs-icon {
      width: 52px;
      height: 52px;
      margin: 0 auto 18px;
      border-radius: 50%;
      background: var(--ep-cream);
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

      &--spin svg {
        animation: prefs-spin 0.9s linear infinite;
      }
    }

    @keyframes prefs-spin {
      to { transform: rotate(360deg); }
    }

    .eyebrow {
      margin: 0 0 8px;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--ep-gold-dark);

      &--warn { color: #c2410c; }
    }

    h1 {
      font-size: clamp(1.45rem, 4vw, 1.7rem);
      font-weight: 700;
      margin: 0 0 10px;
      color: var(--ep-ink);
      letter-spacing: -0.03em;
      line-height: 1.2;
    }

    .intro {
      color: var(--ep-muted);
      font-size: 0.95rem;
      margin: 0 0 28px;
      line-height: 1.6;
    }

    .account-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 28px;
      padding: 8px 14px;
      border-radius: 999px;
      background: var(--ep-cream);
      border: 1px solid var(--ep-line);
      color: var(--ep-ink);
      font-size: 0.88rem;
      font-weight: 600;
      word-break: break-all;
    }

    .account-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--ep-gold);
      flex-shrink: 0;
    }

    .email-form {
      text-align: left;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .field label {
      display: block;
      font-size: 0.78rem;
      font-weight: 700;
      color: var(--ep-ink);
      margin-bottom: 7px;
      letter-spacing: 0.02em;
    }

    .input {
      width: 100%;
      box-sizing: border-box;
      padding: 13px 14px;
      border: 1px solid var(--ep-border);
      border-radius: 12px;
      font-size: 0.95rem;
      font-family: inherit;
      color: var(--ep-ink) !important;
      background: #fff !important;
      color-scheme: light;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;

      &::placeholder { color: #9a9a9a; }
      &:hover { border-color: rgba(17, 17, 17, 0.22); }
      &:focus {
        outline: none;
        border-color: var(--ep-gold);
        box-shadow: 0 0 0 3px rgba(201, 168, 76, 0.22);
      }
    }

    .secure-note {
      margin: 18px 0 0;
      font-size: 0.78rem;
      line-height: 1.45;
      color: var(--ep-muted);
    }

    .panel {
      margin-top: 8px;
      padding: 18px;
      border-radius: 14px;
      border: 1px solid var(--ep-border);
      background: #fafafa;
    }

    .panel + .panel {
      margin-top: 14px;
    }

    .panel-head {
      margin-bottom: 14px;

      h2 {
        margin: 0 0 4px;
        font-size: 0.95rem;
        font-weight: 700;
        color: var(--ep-ink);
        letter-spacing: -0.01em;
      }

      p {
        margin: 0;
        font-size: 0.8rem;
        color: var(--ep-muted);
        line-height: 1.45;
      }
    }

    .lang-options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .lang-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 11px 12px;
      border: 1px solid var(--ep-border);
      border-radius: 12px;
      background: #fff;
      color: var(--ep-text);
      cursor: pointer;
      font-family: inherit;
      text-align: left;
      transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;

      &:hover:not(:disabled):not(.active) {
        border-color: var(--ep-gold);
      }

      &.active {
        background: var(--ep-ink);
        border-color: var(--ep-ink);
        box-shadow: inset 0 0 0 1px rgba(201, 168, 76, 0.35);

        .lang-code { color: var(--ep-gold); border-color: rgba(201, 168, 76, 0.45); }
        .lang-name { color: #f0ede8; }
      }

      &:disabled { opacity: 0.55; cursor: not-allowed; }
    }

    .lang-code {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 32px;
      height: 24px;
      padding: 0 6px;
      border-radius: 6px;
      border: 1px solid var(--ep-border);
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      color: var(--ep-gold-dark);
      background: var(--ep-cream);
    }

    .lang-name {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--ep-ink);
    }

    .status {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 14px;
      border-radius: 12px;
      border: 1px solid var(--ep-border);
      background: #fff;

      &--on {
        border-color: var(--ep-line);
        background: var(--ep-cream);
      }

      &--off {
        border-color: #fed7aa;
        background: #fff7ed;
      }
    }

    .status-copy {
      display: flex;
      flex-direction: column;
      gap: 4px;

      strong {
        font-size: 0.9rem;
        color: var(--ep-ink);
      }

      span {
        font-size: 0.8rem;
        color: var(--ep-muted);
        line-height: 1.45;
      }
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 13px 20px;
      border: none;
      border-radius: 999px;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      font-family: inherit;
      letter-spacing: 0.02em;
      transition: transform 0.12s ease, opacity 0.12s ease, background 0.15s ease, border-color 0.15s ease;

      &:disabled { opacity: 0.55; cursor: not-allowed; }
      &:not(:disabled):active { transform: scale(0.985); }
    }

    .btn-primary {
      width: 100%;
      background: var(--ep-gold);
      color: #090909;
      box-shadow: 0 8px 20px rgba(201, 168, 76, 0.28);

      &:hover:not(:disabled) { background: var(--ep-gold-soft); }
    }

    .btn-secondary {
      width: 100%;
      background: var(--ep-ink);
      color: var(--ep-gold);

      &:hover:not(:disabled) { background: #1a1a1a; }
    }

    .btn-ghost {
      width: 100%;
      background: transparent;
      color: #9b3030;
      border: 1px solid rgba(155, 48, 48, 0.28);

      &:hover:not(:disabled) {
        background: rgba(155, 48, 48, 0.06);
        border-color: rgba(155, 48, 48, 0.45);
      }
    }

    .home-link {
      display: inline-block;
      margin-top: 22px;
      color: var(--ep-gold-dark);
      font-size: 0.85rem;
      font-weight: 600;
      text-decoration: none;

      &:hover { text-decoration: underline; }
    }

    .prefs-card--manage .home-link {
      display: block;
      text-align: center;
    }

    .banner {
      margin: 14px 0 0;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 0.84rem;
      font-weight: 600;
      text-align: left;
      line-height: 1.4;

      &--ok {
        color: #1d5e3a;
        background: #edf9f2;
        border: 1px solid #82d4a8;
      }

      &--error {
        color: #9b3030;
        background: #fdf2f2;
        border: 1px solid #f0b4b4;
      }
    }

    .prefs-footnote {
      margin: 0;
      font-size: 0.75rem;
      color: rgba(240, 237, 232, 0.42);
      text-align: center;

      a {
        color: var(--ep-gold);
        text-decoration: none;
        &:hover { text-decoration: underline; }
      }
    }

    @media (max-width: 480px) {
      .prefs-page { padding: 28px 16px; }
      .prefs-card { padding: 28px 20px 22px; border-radius: 16px; }
      .lang-options { grid-template-columns: 1fr; }
    }
  `]
})
export class EmailPreferencesComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private apiUrl = API_CONFIG.getApiUrl();

  readonly languages: Language[] = ['pt', 'en', 'fr', 'es'];
  readonly languageLabels = LANGUAGE_LABELS;
  readonly languageFlags = LANGUAGE_FLAGS;

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
