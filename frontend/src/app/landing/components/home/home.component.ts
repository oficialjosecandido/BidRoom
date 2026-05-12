import { Component, OnDestroy, OnInit, AfterViewInit, inject, ElementRef, ViewChild, HostListener } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  private translate = inject(TranslateService);

  @ViewChild('carouselWrap') carouselWrap!: ElementRef<HTMLElement>;
  @ViewChild('carouselTrack') carouselTrack!: ElementRef<HTMLElement>;

  isLight = false;
  carouselCurrent = 0;
  carouselTransform = 'translateX(0)';

  heroBid = '€ 8.400';
  heroTimer = '4:23:07';
  rvBid = '€ 12.800';
  rvTimer = '00:42';
  rvActiveIdx = 0;

  readonly CARDS = 5;

  private readonly hbids = ['€ 8.400', '€ 8.750', '€ 9.100', '€ 9.600'];
  private readonly rbids = ['€ 12.800', '€ 13.200', '€ 13.600', '€ 14.200', '€ 14.900'];
  private hi = 0;
  private hs = 15787;
  private ri = 0;
  private rs = 42;
  private timers: ReturnType<typeof setInterval>[] = [];
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private touchStartX = 0;

  get currentLang(): string {
    return this.translate.currentLang || 'pt';
  }

  get toggleLangLabel(): string {
    return this.currentLang === 'pt' ? 'EN' : 'PT';
  }

  ngOnInit(): void {
    const saved = localStorage.getItem('lang') || 'pt';
    this.translate.use(saved);
    const pref = localStorage.getItem('bidroom-theme-preference') || 'dark';
    this.isLight = pref === 'light';

    this.timers.push(setInterval(() => {
      this.hi = (this.hi + 1) % this.hbids.length;
      this.heroBid = this.hbids[this.hi];
    }, 3500));

    this.timers.push(setInterval(() => {
      if (this.hs > 0) this.hs--;
      const h = Math.floor(this.hs / 3600);
      const m = Math.floor((this.hs % 3600) / 60);
      const s = this.hs % 60;
      this.heroTimer = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }, 1000));

    this.timers.push(setInterval(() => {
      this.rvActiveIdx = (this.rvActiveIdx + 1) % 5;
    }, 2000));

    this.timers.push(setInterval(() => {
      this.rs = this.rs > 0 ? this.rs - 1 : 58;
      const mm = String(Math.floor(this.rs / 60)).padStart(2, '0');
      const ss = String(this.rs % 60).padStart(2, '0');
      this.rvTimer = `${mm}:${ss}`;
      if (this.rs % 14 === 0) {
        this.ri = (this.ri + 1) % this.rbids.length;
        this.rvBid = this.rbids[this.ri];
      }
    }, 1000));
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.updateCarouselTransform(), 0);
    this.startCarouselAuto();
  }

  ngOnDestroy(): void {
    this.timers.forEach(t => clearInterval(t));
    if (this.autoTimer) clearInterval(this.autoTimer);
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateCarouselTransform();
  }

  toggleTheme(): void {
    this.isLight = !this.isLight;
    localStorage.setItem('bidroom-theme-preference', this.isLight ? 'light' : 'dark');
  }

  toggleLang(): void {
    const next = this.currentLang === 'pt' ? 'en' : 'pt';
    this.translate.use(next);
    localStorage.setItem('lang', next);
  }

  goTo(idx: number, skipAuto = false): void {
    this.carouselCurrent = ((idx % this.CARDS) + this.CARDS) % this.CARDS;
    this.updateCarouselTransform();
    if (!skipAuto) this.resetCarouselAuto();
  }

  onCarouselTouchStart(e: TouchEvent): void {
    this.touchStartX = e.touches[0].clientX;
  }

  onCarouselTouchEnd(e: TouchEvent): void {
    const dx = e.changedTouches[0].clientX - this.touchStartX;
    if (Math.abs(dx) > 40) this.goTo(this.carouselCurrent + (dx < 0 ? 1 : -1));
  }

  private updateCarouselTransform(): void {
    const wrap = this.carouselWrap?.nativeElement;
    const track = this.carouselTrack?.nativeElement;
    if (!wrap || !track) return;
    const card = track.querySelector('.hc') as HTMLElement | null;
    if (!card) return;
    const cardW = card.offsetWidth + 16;
    const wrapW = wrap.offsetWidth;
    const offset = this.carouselCurrent * cardW - (wrapW / 2 - cardW / 2);
    this.carouselTransform = `translateX(${-offset}px)`;
  }

  private startCarouselAuto(): void {
    this.autoTimer = setInterval(() => {
      this.carouselCurrent = (this.carouselCurrent + 1) % this.CARDS;
      this.updateCarouselTransform();
    }, 4000);
  }

  private resetCarouselAuto(): void {
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.startCarouselAuto();
  }
}
