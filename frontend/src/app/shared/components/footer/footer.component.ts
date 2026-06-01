import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BidroomLogoComponent } from '../bidroom-logo/bidroom-logo.component';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [TranslateModule, RouterLink, BidroomLogoComponent],
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss']
})
export class FooterComponent {
  private router = inject(Router);
}
