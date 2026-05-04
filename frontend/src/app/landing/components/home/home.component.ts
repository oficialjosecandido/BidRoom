import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, OnDestroy {
  private translate = inject(TranslateService);

  isLight = false;
  langMenuOpen = false;
  readonly languages = [
    { code: 'en', label: 'EN', name: 'English' },
    { code: 'pt', label: 'PT', name: 'Português' },
    { code: 'es', label: 'ES', name: 'Español' },
    { code: 'fr', label: 'FR', name: 'Français' }
  ];

  private pvtSeconds = 47;
  private timerId: ReturnType<typeof setInterval> | null = null;

  get themeLabel(): string {
    return this.isLight ? 'Modo claro' : 'Modo escuro';
  }

  get privateTimerDisplay(): string {
    const m = Math.floor(this.pvtSeconds / 60);
    const s = this.pvtSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  get currentLang(): string {
    return this.translate.currentLang || 'en';
  }

  get currentLangLabel(): string {
    return this.languages.find((l) => l.code === this.currentLang)?.label ?? 'EN';
  }

  ngOnInit(): void {
    const saved = localStorage.getItem('lang') || 'pt';
    this.translate.use(saved);
    this.timerId = setInterval(() => {
      this.pvtSeconds = Math.max(0, this.pvtSeconds - 1);
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
    }
  }

  toggleTheme(): void {
    this.isLight = !this.isLight;
  }

  toggleLangMenu(): void {
    this.langMenuOpen = !this.langMenuOpen;
  }

  switchLanguage(code: string): void {
    this.translate.use(code);
    localStorage.setItem('lang', code);
    this.langMenuOpen = false;
  }
}
