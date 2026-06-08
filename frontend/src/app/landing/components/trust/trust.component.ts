import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';

@Component({
  selector: 'app-trust',
  standalone: true,
  imports: [HeaderComponent, FooterComponent, TranslateModule, RouterLink],
  templateUrl: './trust.component.html',
  styleUrls: ['./trust.component.scss']
})
export class TrustComponent {
  activeView: 'buyer' | 'seller' = 'buyer';
  openFaq: string | null = null;

  switchView(view: 'buyer' | 'seller'): void {
    this.activeView = view;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  toggleFaq(id: string): void {
    this.openFaq = this.openFaq === id ? null : id;
  }
}
