import { Component, OnInit, OnDestroy, inject, ChangeDetectionStrategy, ChangeDetectorRef, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { BlogService, BlogPost } from '../../../shared/services/blog.service';
import { SeoService } from '../../../shared/services/seo.service';
import { renderMarkdown } from '../../../shared/utils/markdown.util';
import { getLocalizedBlogContent, getLocalizedBlogTitle } from '../../../shared/utils/blog-locale';
import { ThemeService } from '../../../shared/services/theme.service';
import { API_CONFIG } from '../../../shared/config/api.config';
import { AnalyticsService } from '../../../shared/services/analytics.service';
import { AnalyticsEvents } from '../../../shared/services/analytics.events';

@Component({
  selector: 'app-blog-post',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './blog-post.component.html',
  styleUrls: ['./blog-post.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlogPostComponent implements OnInit, OnDestroy {
  private blogService = inject(BlogService);
  private seo = inject(SeoService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private translate = inject(TranslateService);
  private themeService = inject(ThemeService);
  private analytics = inject(AnalyticsService);

  post: BlogPost | null = null;
  contentHtml = '';
  loading = true;
  notFound = false;
  linkCopied = false;
  readonly isLight = computed(() => this.themeService.effective() === 'light');

  private langSub?: Subscription;

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.notFound = true;
      this.loading = false;
      return;
    }

    this.blogService.getPostBySlug(slug).subscribe({
      next: ({ post }) => {
        this.post = post;
        this.loading = false;
        this.applyLocalizedContent();
        this.cdr.markForCheck();
      },
      error: () => {
        this.notFound = true;
        this.loading = false;
        this.cdr.markForCheck();
      }
    });

    this.langSub = this.translate.onLangChange.subscribe(() => {
      if (this.post) this.applyLocalizedContent();
    });
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  private applyLocalizedContent(): void {
    if (!this.post) return;
    const lang = this.translate.currentLang || 'pt';
    this.contentHtml = renderMarkdown(getLocalizedBlogContent(this.post, lang));
    this.seo.setBlogPost(this.post, lang);
    this.cdr.markForCheck();
  }

  postTitle(): string {
    if (!this.post) return '';
    return getLocalizedBlogTitle(this.post, this.translate.currentLang || 'pt');
  }

  categoryLabel(category: string): string {
    return `blog.categories.${category}`;
  }

  buildShareUrl(slug: string): string {
    const backendBase = API_CONFIG.getBackendBaseUrl();
    return `${backendBase}/api/share/blog/${slug}`;
  }

  async sharePost(): Promise<void> {
    if (!this.post) return;
    const shareUrl = this.buildShareUrl(this.post.slug);
    const title = `BidRoom | ${this.postTitle()}`;
    const text = this.postTitle();

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: shareUrl });
        this.analytics.trackEvent(AnalyticsEvents.SHARE_BLOG_POST, { share_method: 'native', blog_slug: this.post.slug });
      } catch {
        /* cancelled by user */
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      this.linkCopied = true;
      this.analytics.trackEvent(AnalyticsEvents.SHARE_BLOG_POST, { share_method: 'clipboard', blog_slug: this.post.slug });
      setTimeout(() => {
        this.linkCopied = false;
        this.cdr.markForCheck();
      }, 2500);
    }
  }

  goToBlog(): void {
    this.router.navigate(['/blog']);
  }
}
