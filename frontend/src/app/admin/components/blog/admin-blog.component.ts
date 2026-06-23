import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BlogService, BlogPostAdmin } from '../../../shared/services/blog.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';

@Component({
  selector: 'app-admin-blog',
  standalone: true,
  imports: [CommonModule, RouterModule, AdminSidebarComponent],
  templateUrl: './admin-blog.component.html',
  styleUrls: ['./admin-blog.component.scss']
})
export class AdminBlogComponent implements OnInit {
  private blogService = inject(BlogService);

  posts: BlogPostAdmin[] = [];
  isLoading = false;
  error: string | null = null;
  deletingId: string | null = null;

  private readonly categoryLabelMap: Record<string, string> = {
    relogios: 'Relógios',
    arte: 'Arte',
    mercado: 'Mercado',
    guias: 'Guias',
    bidroom: 'BidRoom'
  };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading = true;
    this.error = null;
    this.blogService.getAllPostsAdmin().subscribe({
      next: (res) => {
        this.posts = res.posts ?? [];
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to load posts';
        this.isLoading = false;
      }
    });
  }

  categoryLabel(cat: string): string {
    return this.categoryLabelMap[cat] ?? cat;
  }

  formatDate(dateString: string | null): string {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  deletePost(post: BlogPostAdmin, event: Event): void {
    event.stopPropagation();
    if (this.deletingId) return;
    if (!confirm(`Eliminar "${post.title}"? Esta ação é permanente.`)) return;
    this.deletingId = post._id;
    this.blogService.deletePost(post._id).subscribe({
      next: () => {
        this.posts = this.posts.filter(p => p._id !== post._id);
        this.deletingId = null;
      },
      error: (err) => {
        this.deletingId = null;
        alert(err?.error?.error || 'Failed to delete post.');
      }
    });
  }
}
