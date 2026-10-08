import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../services/language.service';

/** The fields of a notification this pipe can render. */
type NotificationField = 'title' | 'message';

/** What the pipe needs from a notification; the full interface has more. */
interface LocalizableNotification {
  title: string;
  message: string;
  i18nKey?: string | null;
  i18nParams?: Record<string, unknown> | null;
}

/**
 * Renders a notification's title or message in the reader's language.
 *
 * Notifications used to be written to the database as finished English
 * sentences, so a Portuguese user's notification list was the one part of the
 * app that never translated. The backend now stores a catalogue key plus the
 * values to interpolate, and the text is produced here — at read time.
 *
 * Read time, not write time, is the point: a notification list is live UI that
 * the same person comes back to, so it has to follow them when they change
 * language. (Emails are the opposite — a snapshot in an inbox — and are
 * rendered in the recipient's language when they are sent.)
 *
 * `title`/`message` are still on the document as the English fallback, which
 * is what renders for every notification written before the key existed.
 *
 * pure: false — the output depends on the current language, which changes at
 * runtime without the notification object changing.
 */
@Pipe({ name: 'notificationText', standalone: true, pure: false })
export class NotificationTextPipe implements PipeTransform {
  private translate = inject(TranslateService);
  private language = inject(LanguageService);

  transform(notification: LocalizableNotification | null | undefined, field: NotificationField): string {
    if (!notification) return '';

    const fallback = notification[field] || '';
    if (!notification.i18nKey) return fallback;

    // Reading the signal is what ties this pipe to a language change; the
    // impure pipe is then re-evaluated and asks ngx-translate again.
    this.language.current();

    const key = `${notification.i18nKey}.${field}`;
    const rendered = this.translate.instant(key, this.resolveParams(notification.i18nParams));

    // ngx-translate echoes the key back when it has no entry for it. Showing
    // "notifications.newBid.message" to a user is worse than showing the
    // English sentence we already have, so a miss falls back.
    return rendered && rendered !== key ? rendered : fallback;
  }

  /**
   * A parameter whose value is `{ t: 'some.key' }` is itself a key to
   * translate. That is how a stand-in for missing data — "your listing", when
   * the listing has no title on file — reaches the reader in their own
   * language instead of in English.
   */
  private resolveParams(params: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!params) return {};
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(params)) {
      const standInKey = this.standInKey(value);
      out[name] = standInKey ? this.translate.instant(standInKey) : value;
    }
    return out;
  }

  private standInKey(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const key = (value as { t?: unknown }).t;
    return typeof key === 'string' && key ? key : null;
  }
}
