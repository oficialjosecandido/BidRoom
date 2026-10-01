import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { CustomerService } from './customer.service';
import { AuthService } from '../../auth/services/auth.service';

export type AppLanguage = 'en' | 'pt' | 'es' | 'fr';

export const SUPPORTED_LANGUAGES: AppLanguage[] = ['en', 'pt', 'es', 'fr'];

const STORAGE_KEY = 'lang';

/**
 * The single place the app language is changed.
 *
 * It used to be changed in six places, and only the one in Settings told the
 * server. Everyone who switched to Portuguese in the header picker still had
 * Customer.language = 'en' in the database, so their transactional emails went
 * out in English — the backend reads that field, not localStorage.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private translate = inject(TranslateService);
  private customerService = inject(CustomerService);
  private auth = inject(AuthService);

  /** The language currently applied to the UI. */
  readonly current = signal<AppLanguage>('en');

  /** Apply the stored choice at startup. Does not patch the server. */
  init(): void {
    this.apply(this.stored(), { patchServer: false });
  }

  /** User picked a language: apply it, remember it, and tell the server. */
  use(code: string): void {
    this.apply(this.parse(code), { patchServer: true });
  }

  /**
   * Adopt the language stored on the profile at login.
   *
   * Only when the device has no choice of its own — someone who just switched
   * to Portuguese on this device should not be flipped back by a stale profile.
   */
  mergeFromServerIfPresent(language: string | null | undefined): void {
    if (!language) return;
    if (this.readStorage()) return;
    this.apply(this.parse(language), { patchServer: false });
  }

  parse(code: string | null | undefined): AppLanguage {
    const normalised = String(code || '').toLowerCase().slice(0, 2) as AppLanguage;
    return SUPPORTED_LANGUAGES.includes(normalised) ? normalised : 'en';
  }

  private apply(lang: AppLanguage, opts: { patchServer: boolean }): void {
    this.current.set(lang);
    this.translate.use(lang);
    this.writeStorage(lang);

    if (opts.patchServer && this.auth.getCurrentUser()) {
      this.customerService.updateLanguage(lang).subscribe({
        error: () => {
          /* offline or session edge — the local choice still applies */
        }
      });
    }
  }

  private stored(): AppLanguage {
    return this.parse(this.readStorage());
  }

  private readStorage(): string | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    } catch {
      return null;
    }
  }

  private writeStorage(lang: AppLanguage): void {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* private mode or blocked storage — the session still has the choice */
    }
  }
}
