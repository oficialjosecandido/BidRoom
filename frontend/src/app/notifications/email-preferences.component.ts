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
          <h1>A carregar…</h1>
        } @else if (needsEmail) {
          <div class="state-icon">✉️</div>
          <h1>Preferências de email</h1>
          <p class="intro">Para cancelar a subscrição ou alterar o idioma, confirme o seu email.</p>

          <form class="email-form" (ngSubmit)="lookupByEmail()">
            <div class="field">
              <label for="prefs-email">Email</label>
              <input id="prefs-email" type="email" class="input" [(ngModel)]="emailInput" name="email" autocomplete="email" required />
            </div>
            <div class="field">
              <label for="prefs-email-confirm">Repetir email</label>
              <input id="prefs-email-confirm" type="email" class="input" [(ngModel)]="emailConfirmInput" name="emailConfirm" autocomplete="email" required />
            </div>
            @if (lookupError) { <p class="save-message error">{{ lookupError }}</p> }
            <button type="submit" class="btn btn-primary" [disabled]="lookingUp || !emailInput.trim() || !emailConfirmInput.trim()">
              {{ lookingUp ? 'A verificar…' : 'Continuar' }}
            </button>
          </form>
        } @else if (invalid) {
          <div class="state-icon">❌</div>
          <h1>Link inválido</h1>
          <p>{{ errorMessage }}</p>
          <button type="button" class="btn btn-secondary" (click)="showEmailForm()">Usar o meu email</button>
          <a routerLink="/landing" class="home-link">Ir para a página inicial</a>
        } @else {
          <div class="state-icon">✉️</div>
          <h1>Preferências de email</h1>
          <p class="email-line">{{ email }}</p>

          <div class="section">
            <label>Idioma preferido</label>
            <div class="lang-options">
              @for (lang of languages; track lang) {
                <button type="button" class="lang-btn" [class.active]="language === lang" [disabled]="saving" (click)="saveLanguage(lang)">
                  {{ languageLabels[lang] }}
                </button>
              }
            </div>
          </div>

          <div class="section">
            <label>Subscrição</label>
            @if (unsubscribed) {
              <p class="status-text">Cancelou a subscrição dos emails BidRoom.</p>
              <button type="button" class="btn btn-secondary" [disabled]="saving" (click)="resubscribe()">Voltar a subscrever</button>
            } @else {
              <p class="status-text">Está subscrito aos emails BidRoom.</p>
              <button type="button" class="btn btn-danger" [disabled]="saving" (click)="unsubscribe()">Cancelar subscrição</button>
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
    .intro { color: #64748b; font-size: 14px; margin: 0 0 20px; line-height: 1.5; }
    .email-line { color: #64748b; font-size: 14px; margin: 0 0 24px; }
    p { color: #555; line-height: 1.6; margin: 0 0 16px; }
    a { color: var(--primary-color, #1565c0); text-decoration: underline; }
    .home-link { display: inline-block; margin-top: 12px; }

    .email-form {
      text-align: left;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .field label {
      display: block;
      font-size: 13px;
      font-weight: 700;
      color: #334155;
      margin-bottom: 6px;
    }
    .input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
    }
    .input:focus {
      outline: none;
      border-color: #94a3b8;
    }

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
      font-family: inherit;
      &:disabled { opacity: 0.6; cursor: not-allowed; }
    }
    .btn-primary { background: #0f172a; color: #fff; width: 100%; }
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
