import { Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { SeoService } from '../../../shared/services/seo.service';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [RouterLink, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './about.component.html',
  styleUrls: ['./about.component.scss'],
})
export class AboutComponent implements OnInit {
  private seo = inject(SeoService);
  private translate = inject(TranslateService);

  readonly people = [
    { initials: 'JC', nameKey: 'p1.name', roleKey: 'p1.role', bioKey: 'p1.bio' },
  ] as const;

  ngOnInit(): void {
    this.seo.setPage({
      title: this.translate.instant('seoPages.about.titleTag'),
      description: this.translate.instant('seoPages.about.description'),
      path: '/landing/about',
    });
    this.seo.setBreadcrumbs([
      { name: 'BidRoom', path: '/' },
      { name: this.translate.instant('seoPages.about.nav'), path: '/landing/about' },
    ]);
  }
}
