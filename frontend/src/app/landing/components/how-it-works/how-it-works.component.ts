import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';

type Tab = 'buyer' | 'seller' | 'private' | 'payments';

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
  openFaqs: Record<string, number | null> = { buyer: null, seller: null, payments: null };

  prTimer = 42;
  prSeats = [true, false, true, false, true];

  private timerInterval?: ReturnType<typeof setInterval>;
  private seatInterval?: ReturnType<typeof setInterval>;
  private seatIndex = 0;

  readonly buyerFaqs = [0, 1, 2, 3, 4];
  readonly sellerFaqs = [0, 1, 2, 3, 4];
  readonly paymentsFaqs = [0, 1, 2, 3];

  ngOnInit(): void {
    this.timerInterval = setInterval(() => {
      this.prTimer = this.prTimer > 0 ? this.prTimer - 1 : 58;
    }, 1000);

    this.seatInterval = setInterval(() => {
      this.prSeats = [false, false, false, false, false];
      this.prSeats[this.seatIndex % 5] = true;
      this.prSeats[(this.seatIndex + 2) % 5] = true;
      this.seatIndex++;
    }, 2000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timerInterval);
    clearInterval(this.seatInterval);
  }

  switchTab(tab: Tab): void {
    this.activeTab = tab;
    const tabsBar = document.querySelector('.tabs-bar') as HTMLElement | null;
    window.scrollTo({ top: (tabsBar?.offsetTop ?? 0) - 52, behavior: 'smooth' });
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

  navigateToAuth(): void {
    this.router.navigate(['/auth/signup']);
  }

  navigateToAuctions(): void {
    this.router.navigate(['/listing/list']);
  }
}
