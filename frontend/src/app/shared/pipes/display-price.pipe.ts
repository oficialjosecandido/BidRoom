import { Pipe, PipeTransform, inject } from '@angular/core';
import { CurrencyDisplayService } from '../services/currency-display.service';

/**
 * Always shows the EUR price (the real transaction currency) and, when the user
 * has chosen a display currency, appends the indicative conversion: "€100,00 (≈ £86)"
 *
 * pure: false — the pipe depends on the displayCurrency signal which changes at runtime.
 */
@Pipe({ name: 'displayPrice', standalone: true, pure: false })
export class DisplayPricePipe implements PipeTransform {
  private currencyService = inject(CurrencyDisplayService);

  transform(amountEur: number | null | undefined): string {
    if (amountEur == null) return '';
    const eur = `€${amountEur.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const converted = this.currencyService.convert(amountEur);
    if (!converted) return eur;

    const approx = converted.value.toLocaleString('en', { maximumFractionDigits: 0 });
    return `${eur} (≈ ${converted.symbol}${approx})`;
  }
}
