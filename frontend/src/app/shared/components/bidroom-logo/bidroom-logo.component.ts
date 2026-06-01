import { Component, HostBinding, Input } from '@angular/core';

export type BidroomLogoVariant = 'horizontal' | 'vertical' | 'icon';

@Component({
  selector: 'app-bidroom-logo',
  standalone: true,
  templateUrl: './bidroom-logo.component.html',
  styleUrls: ['./bidroom-logo.component.scss'],
})
export class BidroomLogoComponent {
  /** horizontal (navbar), vertical (stacked), icon (compact mark) */
  @Input() variant: BidroomLogoVariant = 'horizontal';
  /** Tighter horizontal layout for nav bars (icon + wordmark + .pt) */
  @Input() compact = false;
  /** Play arc fill + pulse on load */
  @Input() animated = true;
  /** Height in px; width follows aspect ratio */
  @Input() height = 36;
  /** Show “.pt” suffix on horizontal / vertical wordmarks */
  @Input() showPt = true;

  @HostBinding('style.height.px') get hostHeight(): number {
    return this.height;
  }

  get viewBox(): string {
    if (this.variant === 'horizontal') {
      return this.compact ? '0 0 168 40' : '0 0 220 56';
    }
    if (this.variant === 'vertical') return '0 0 120 110';
    return '0 0 64 64';
  }
}
