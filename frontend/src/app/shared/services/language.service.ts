import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/services/auth.service';
import { API_CONFIG } from '../config/api.config';

export type AppLanguage = 'en' | 'pt' | 'es' | 'fr';

export const SUPPORTED_LANGUAGES: AppLanguage[] = ['en', 'pt', 'es', 'fr'];

/**
 * The language the app shows when nothing else is known. Must stay in step with
 * DEFAULT_LANG in app.config.ts, which is what ngx-translate boots with and
 * what the server renders during SSR.
 */
export const DEFAULT_LANGUAGE: AppLanguage = 'pt';

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
  private auth = inject(AuthService);
  // HttpClient directly rather than CustomerService: CustomerService calls into
  // this service when a profile loads, and injecting it back would be a cycle.
  // ThemeService resolves the same problem the same way.
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/customers`;

  /** The language currently applied to the UI. */
  readonly current = signal<AppLanguage>(DEFAULT_LANGUAGE);

  /** Reconcile with the profile once per session, not on every API call. */
  private profileSynced = false;

  /**
   * Apply the device's language at startup. Does not patch the server — there
   * is usually no session yet when this runs.
   */
  init(): void {
    this.apply(this.deviceLanguage(), { patchServer: false, persist: false });
  }

  /** User picked a language: apply it, remember it, and tell the server. */
  use(code: string): void {
    this.apply(this.parse(code), { patchServer: true, persist: true });
  }

  /**
   * Reconcile the device's language with the one on the profile, at login.
   *
   * An explicit choice on this device wins and is pushed up: it is the more
   * recent signal, and someone who just switched to Portuguese here should not
   * be flipped back by a stale profile. Otherwise the profile wins, so a
   * language chosen on a phone follows the user to their laptop.
   *
   * The exception is a profile that says 'en'. Customer.language defaulted to
   * 'en' for every account created before the profile started recording a real
   * choice, so a stored 'en' cannot be told apart from "never chose" — while
   * the app itself has always rendered in Portuguese by default. Trusting it
   * would flip the UI of every existing Portuguese user to English and keep
   * their email in English, which is the bug this is here to close. So 'en' is
   * the one value a browser asking for another language may overrule; one click
   * in the picker writes localStorage and settles it permanently.
   */
  syncWithServer(serverLanguage: string | null | undefined): void {
    if (this.profileSynced) return;
    this.profileSynced = true;

    const chosenHere = this.readStorage();
    if (chosenHere) {
      const local = this.parse(chosenHere);
      this.apply(local, { patchServer: local !== this.parse(serverLanguage), persist: true });
      return;
    }

    const fromBrowser = this.browserLanguage();
    const onProfile = serverLanguage ? this.parse(serverLanguage) : null;
    const profileIsAmbiguous = onProfile === 'en' && !!fromBrowser && fromBrowser !== 'en';

    if (onProfile && !profileIsAmbiguous) {
      this.apply(onProfile, { patchServer: false, persist: false });
      return;
    }

    // Nothing trustworthy on either side: infer, and write it to the profile so
    // the emails stop being decided by a column default.
    const inferred = fromBrowser || DEFAULT_LANGUAGE;
    this.apply(inferred, { patchServer: inferred !== onProfile, persist: false });
  }

  parse(code: string | null | undefined): AppLanguage {
    const normalised = String(code || '').toLowerCase().slice(0, 2) as AppLanguage;
    return SUPPORTED_LANGUAGES.includes(normalised) ? normalised : DEFAULT_LANGUAGE;
  }

  /**
   * `persist` is false for a language we merely inferred (from the browser, or
   * from the profile). Storing an inferred language would make it look like an
   * explicit choice on the next load, and syncWithServer would then push it up
   * over the profile — flipping a user whose profile says 'fr' to 'pt' on every
   * login just because their browser is Portuguese.
   */
  private apply(lang: AppLanguage, opts: { patchServer: boolean; persist: boolean }): void {
    this.current.set(lang);
    this.translate.use(lang);
    if (opts.persist) this.writeStorage(lang);

    if (opts.patchServer && this.auth.getCurrentUser()) {
      this.http.patch(`${this.apiUrl}/language`, { language: lang }).subscribe({
        error: () => {
          /* offline or session edge — the local choice still applies */
        }
      });
    }
  }

  /**
   * What this device should be showing: an explicit choice, else what the
   * browser asks for.
   *
   * Without the browser fallback, every new visitor started in English — on a
   * marketplace whose sellers and buyers are mostly Portuguese, and whose
   * emails are written in whatever this resolves to.
   */
  private deviceLanguage(): AppLanguage {
    const chosen = this.readStorage();
    if (chosen) return this.parse(chosen);
    return this.browserLanguage() || DEFAULT_LANGUAGE;
  }

  /**
   * The first language the browser asks for that we actually serve, or null.
   *
   * Null rather than the default, because syncWithServer has to tell "the
   * browser wants Portuguese" apart from "the browser wants something we do not
   * speak" — only the former is strong enough to overrule a profile.
   */
  private browserLanguage(): AppLanguage | null {
    for (const tag of this.browserLanguages()) {
      const parsed = String(tag || '').toLowerCase().slice(0, 2) as AppLanguage;
      if (SUPPORTED_LANGUAGES.includes(parsed)) return parsed;
    }
    return null;
  }

  /** navigator.languages in preference order, guarded for SSR and old browsers. */
  private browserLanguages(): string[] {
    try {
      if (typeof navigator === 'undefined') return [];
      return [...(navigator.languages || []), navigator.language].filter(Boolean) as string[];
    } catch {
      return [];
    }
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
