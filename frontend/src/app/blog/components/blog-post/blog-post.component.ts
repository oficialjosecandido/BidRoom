import { Component, OnInit, inject, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { BlogService, BlogPost } from '../../../shared/services/blog.service';
import { SeoService } from '../../../shared/services/seo.service';
import { renderMarkdown } from '../../../shared/utils/markdown.util';

@Component({
  selector: 'app-blog-post',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './blog-post.component.html',
  styleUrls: ['./blog-post.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlogPostComponent implements OnInit {
  private blogService = inject(BlogService);
  private seo = inject(SeoService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  post: BlogPost | null = null;
  contentHtml = '';
  loading = true;
  notFound = false;

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
        this.contentHtml = renderMarkdown(post.content);
        this.loading = false;
        this.seo.setBlogPost(post);
        this.cdr.markForCheck();
      },
      error: () => {
        this.notFound = true;
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  categoryLabel(category: string): string {
    return `blog.categories.${category}`;
  }

  goToBlog(): void {
    this.router.navigate(['/blog']);
  }
}
