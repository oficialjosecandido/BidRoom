import { Component, OnInit, inject, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { BlogService, BlogPostSummary, BlogCategory } from '../../../shared/services/blog.service';
import { SeoService } from '../../../shared/services/seo.service';

const CATEGORIES: { value: BlogCategory | ''; labelKey: string }[] = [
  { value: '',          labelKey: 'blog.categories.all' },
  { value: 'relogios',  labelKey: 'blog.categories.relogios' },
  { value: 'arte',      labelKey: 'blog.categories.arte' },
  { value: 'mercado',   labelKey: 'blog.categories.mercado' },
  { value: 'guias',     labelKey: 'blog.categories.guias' },
  { value: 'bidroom',   labelKey: 'blog.categories.bidroom' },
];

@Component({
  selector: 'app-blog-list',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './blog-list.component.html',
  styleUrls: ['./blog-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlogListComponent implements OnInit {
  private blogService = inject(BlogService);
  private seo = inject(SeoService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  readonly categories = CATEGORIES;

  posts: BlogPostSummary[] = [];
  loading = true;
  error: string | null = null;
  currentPage = 1;
  totalPages = 1;
  selectedCategory: BlogCategory | '' = '';

  ngOnInit(): void {
    this.seo.setBlogIndex();

    this.route.queryParams.subscribe(params => {
      this.selectedCategory = (params['category'] as BlogCategory) || '';
      this.currentPage = Number(params['page']) || 1;
      this.loadPosts();
    });
  }

  private loadPosts(): void {
    this.loading = true;
    this.error = null;
    this.blogService.getPosts(this.currentPage, 12, this.selectedCategory || undefined).subscribe({
      next: (res) => {
        this.posts = res.posts;
        this.totalPages = res.pages;
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

  selectCategory(category: BlogCategory | ''): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { category: category || null, page: null },
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
}
