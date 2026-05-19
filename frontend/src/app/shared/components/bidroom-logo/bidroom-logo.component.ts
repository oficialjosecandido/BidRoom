import { Component, Input } from '@angular/core';

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
  /** Play arc fill + pulse on load */
  @Input() animated = true;
  /** CSS height in px; width scales from viewBox aspect ratio */
  @Input() height = 36;
  /** Show “.pt” suffix on horizontal / vertical wordmarks */
  @Input() showPt = true;
}
