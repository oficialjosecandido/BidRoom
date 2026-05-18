import { Component, inject } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LegalLayoutComponent } from '../legal/legal-layout.component';
import { CookiePreferencesService } from '../legal/cookie-preferences.service';

@Component({
  selector: 'app-cookies-policy',
  standalone: true,
  imports: [LegalLayoutComponent, TranslateModule],
  templateUrl: './cookies-policy.component.html',
  styleUrls: ['../legal/_legal-content.scss']
})
export class CookiesPolicyComponent {
  readonly prefs = inject(CookiePreferencesService);
  private translate = inject(TranslateService);
  saved = false;

  savePreferences(): void {
    this.prefs.applyConsentFromToggles();
    this.saved = true;
    setTimeout(() => { this.saved = false; }, 3000);
  }

  get savedMessage(): string {
    return this.translate.instant('legal.cookies.saved');
  }
}
