import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { SeoService } from '../../../shared/services/seo.service';

@Component({
  selector: 'app-thank-you',
  standalone: true,
  imports: [RouterLink, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './thank-you.component.html',
  styleUrls: ['./thank-you.component.scss'],
})
export class ThankYouComponent implements OnInit {
  private seo = inject(SeoService);
  private translate = inject(TranslateService);

  ngOnInit(): void {
    this.seo.setPage({
      title: this.translate.instant('seoPages.thankYou.titleTag'),
      description: this.translate.instant('seoPages.thankYou.description'),
      path: '/landing/thank-you',
    });
  }
}
