import { Component, Input, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ThemeService } from '../../../shared/services/theme.service';
import { BidroomLogoComponent } from '../../../shared/components/bidroom-logo/bidroom-logo.component';

export type LegalTab = 'terms' | 'privacy' | 'cookies' | 'contact';

@Component({
  selector: 'app-legal-layout',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, TranslateModule, BidroomLogoComponent],
  templateUrl: './legal-layout.component.html',
  styleUrls: ['./legal-layout.component.scss']
})
export class LegalLayoutComponent {
  @Input({ required: true }) activeTab!: LegalTab;

  private router = inject(Router);
  readonly theme = inject(ThemeService);
  private translate = inject(TranslateService);

  get themeGlyph(): string {
    const p = this.theme.preference();
    if (p === 'light') return '☽';
    if (p === 'dark') return '☀';
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches ? '☽' : '☀';
  }

  get currentLang(): string {
    return this.translate.currentLang || 'pt';
  }

  cycleTheme(): void {
    const p = this.theme.preference();
    const next = p === 'dark' ? 'light' : p === 'light' ? 'system' : 'dark';
    this.theme.setPreference(next);
  }

  switchLanguage(code: string): void {
    this.translate.use(code);
    localStorage.setItem('lang', code);
  }

  navigateToLanding(): void {
    this.router.navigate(['/landing']);
  }
}
