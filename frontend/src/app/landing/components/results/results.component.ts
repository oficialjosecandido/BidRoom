import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { SeoService } from '../../../shared/services/seo.service';

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [RouterLink, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './results.component.html',
  styleUrls: ['./results.component.scss'],
})
export class ResultsComponent implements OnInit {
  private seo = inject(SeoService);
  private translate = inject(TranslateService);

  readonly caseKeys = ['c1', 'c2', 'c3'] as const;

  ngOnInit(): void {
    this.seo.setPage({
      title: this.translate.instant('seoPages.results.titleTag'),
      description: this.translate.instant('seoPages.results.description'),
      path: '/landing/results',
    });
    this.seo.setBreadcrumbs([
      { name: 'BidRoom', path: '/' },
      { name: this.translate.instant('seoPages.results.nav'), path: '/landing/results' },
    ]);
  }
}
