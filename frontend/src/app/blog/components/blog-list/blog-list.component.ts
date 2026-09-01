import { Component, DestroyRef, OnInit, OnDestroy, inject, ChangeDetectionStrategy, ChangeDetectorRef, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { BlogService, BlogPostSummary } from '../../../shared/services/blog.service';
import { SeoService } from '../../../shared/services/seo.service';
import { getLocalizedBlogTitle, getLocalizedBlogExcerpt } from '../../../shared/utils/blog-locale';
import { ThemeService } from '../../../shared/services/theme.service';

@Component({
  selector: 'app-blog-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './blog-list.component.html',
  styleUrls: ['./blog-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlogListComponent implements OnInit, OnDestroy {
  private blogService = inject(BlogService);
  private seo = inject(SeoService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private translate = inject(TranslateService);
  private themeService = inject(ThemeService);
  private destroyRef = inject(DestroyRef);

  posts: BlogPostSummary[] = [];
  loading = true;
  error: string | null = null;
  currentPage = 1;
  totalPages = 1;
  total = 0;
  searchInput = '';
  searchQuery = '';
  readonly isLight = computed(() => this.themeService.effective() === 'light');

  private langSub?: Subscription;

  ngOnInit(): void {
    this.seo.setBlogIndex();

    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.searchQuery = (params['search'] as string) || '';
      this.searchInput = this.searchQuery;
      this.currentPage = Number(params['page']) || 1;
      this.loadPosts();
    });

    this.langSub = this.translate.onLangChange.subscribe(() => {
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  private loadPosts(): void {
    this.loading = true;
    this.error = null;
    this.blogService.getPosts(this.currentPage, 12, this.searchQuery || undefined).subscribe({
      next: (res) => {
        this.posts = res.posts;
        this.totalPages = res.pages;
        this.total = res.total;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'blog.error';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  onSearch(): void {
    const q = this.searchInput.trim();
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { search: q || null, page: null },
      queryParamsHandling: 'merge',
    });
  }

  clearSearch(): void {
    this.searchInput = '';
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { search: null, page: null },
      queryParamsHandling: 'merge',
    });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }

  trackByPost(_: number, p: BlogPostSummary): string {
    return p._id;
  }

  postTitle(post: BlogPostSummary): string {
    return getLocalizedBlogTitle(post, this.translate.currentLang || 'pt');
  }

  postExcerpt(post: BlogPostSummary): string {
    return getLocalizedBlogExcerpt(post, this.translate.currentLang || 'pt');
  }
}
