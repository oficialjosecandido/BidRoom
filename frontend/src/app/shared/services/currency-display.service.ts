import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { API_CONFIG } from '../config/api.config';

export type DisplayCurrency = 'EUR' | 'GBP' | 'USD' | 'BRL';

export const DISPLAY_CURRENCIES: DisplayCurrency[] = ['EUR', 'GBP', 'USD', 'BRL'];

export const CURRENCY_SYMBOLS: Record<DisplayCurrency, string> = {
  EUR: '€', GBP: '£', USD: '$', BRL: 'R$',
};

interface RatesResponse {
  base: 'EUR';
  rates: Partial<Record<DisplayCurrency, number>>;
  fetchedAt: string | null;
  unavailable?: boolean;
}

const STORAGE_KEY = 'bidroom_display_currency';

@Injectable({ providedIn: 'root' })
export class CurrencyDisplayService {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);

  readonly displayCurrency = signal<DisplayCurrency>('EUR');
  readonly rates = signal<Partial<Record<DisplayCurrency, number>>>({});
  readonly ratesAvailable = signal(false);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      const saved = localStorage.getItem(STORAGE_KEY) as DisplayCurrency | null;
      if (saved && DISPLAY_CURRENCIES.includes(saved)) {
        this.displayCurrency.set(saved);
      }
      this.loadRates();
    }
  }

  private loadRates(): void {
    this.http.get<RatesResponse>(`${API_CONFIG.getApiUrl()}/exchange-rates`).subscribe({
      next: (res) => {
        this.rates.set(res.rates ?? {});
        this.ratesAvailable.set(!res.unavailable && Object.keys(res.rates ?? {}).length > 0);
      },
      error: () => this.ratesAvailable.set(false),
    });
  }

  setCurrency(currency: DisplayCurrency): void {
    this.displayCurrency.set(currency);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(STORAGE_KEY, currency);
    }
  }

  symbol(currency: DisplayCurrency = this.displayCurrency()): string {
    return CURRENCY_SYMBOLS[currency];
  }

  /**
   * Converts a EUR amount to the chosen display currency.
   * Returns null when display currency is EUR (no conversion needed) or rates are unavailable.
   */
  convert(amountEur: number): { value: number; currency: DisplayCurrency; symbol: string } | null {
    const cur = this.displayCurrency();
    if (cur === 'EUR') return null;
    const rate = this.rates()[cur];
    if (!rate) return null;
    return { value: amountEur * rate, currency: cur, symbol: CURRENCY_SYMBOLS[cur] };
  }
}
