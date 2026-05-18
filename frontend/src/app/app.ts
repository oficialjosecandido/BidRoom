import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { CookieBannerComponent } from './shared/components/cookie-banner/cookie-banner.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CookieBannerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private translate = inject(TranslateService);

  ngOnInit(): void {
    const saved = localStorage.getItem('lang') || 'en';
    this.translate.use(saved);
  }
}
