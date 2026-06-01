import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';

type Tab = 'buyer' | 'seller' | 'private' | 'payments';

const SEAT_CONFIGS = [
  [true,  false, true,  false, true ],
  [true,  true,  true,  false, true ],
  [true,  true,  true,  true,  false],
  [true,  true,  true,  true,  true ],
  [true,  false, true,  true,  true ],
  [true,  true,  false, true,  true ],
];

const PR_BIDS = [8200, 8450, 8700, 8950, 9200, 9500, 9800, 10100, 10400, 10700];

@Component({
  selector: 'app-how-it-works',
  standalone: true,
  imports: [HeaderComponent, FooterComponent, TranslateModule],
  templateUrl: './how-it-works.component.html',
  styleUrls: ['./how-it-works.component.scss']
})
export class HowItWorksComponent implements OnInit, OnDestroy {
  private router = inject(Router);

  activeTab: Tab = 'buyer';
  openFaqs: Record<string, number | null> = { buyer: null, seller: null, private: null, payments: null };

  prTimer     = 42;
  prSeats     = SEAT_CONFIGS[0].slice();
  prBidIdx    = 0;
  prBidVal    = PR_BIDS[0];
  prBidPulse  = false;

  private timerInterval?: ReturnType<typeof setInterval>;
  private seatInterval?:  ReturnType<typeof setInterval>;
  private bidInterval?:   ReturnType<typeof setInterval>;
  private seatIdx = 0;

  readonly buyerFaqs    = [0, 1, 2, 3, 4];
  readonly sellerFaqs   = [0, 1, 2, 3, 4];
  readonly privateFaqs  = [0, 1, 2, 3];
  readonly paymentsFaqs = [0, 1, 2, 3];

  ngOnInit(): void {
    this.timerInterval = setInterval(() => {
      this.prTimer = this.prTimer > 0 ? this.prTimer - 1 : 58;
    }, 1000);

    this.seatInterval = setInterval(() => {
      this.seatIdx = (this.seatIdx + 1) % SEAT_CONFIGS.length;
      this.prSeats = SEAT_CONFIGS[this.seatIdx].slice();
    }, 2500);

    this.bidInterval = setInterval(() => {
      this.prBidIdx = (this.prBidIdx + 1) % PR_BIDS.length;
      this.prBidVal = PR_BIDS[this.prBidIdx];
      this.prTimer  = Math.min(this.prTimer + 60, 60);
      this.prBidPulse = true;
      setTimeout(() => { this.prBidPulse = false; }, 320);
    }, 4000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timerInterval);
    clearInterval(this.seatInterval);
    clearInterval(this.bidInterval);
  }

  switchTab(tab: Tab): void {
    this.activeTab = tab;
    const tabsBar = document.querySelector('.tabs-bar') as HTMLElement | null;
    window.scrollTo({ top: (tabsBar?.offsetTop ?? 0) - 60, behavior: 'smooth' });
  }

  toggleFaq(section: string, index: number): void {
    this.openFaqs[section] = this.openFaqs[section] === index ? null : index;
  }

  isFaqOpen(section: string, index: number): boolean {
    return this.openFaqs[section] === index;
  }

  get prTimerStr(): string {
    const m = Math.floor(this.prTimer / 60).toString().padStart(2, '0');
    const s = (this.prTimer % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  get prTimerUrgent(): boolean { return this.prTimer <= 10; }

  get prBidFormatted(): string {
    return '€' + this.prBidVal.toLocaleString('pt-PT');
  }

  navigateToAuth(): void    { this.router.navigate(['/auth/signup']); }
  navigateToAuctions(): void { this.router.navigate(['/listing/list']); }
}
