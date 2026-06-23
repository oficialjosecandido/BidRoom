import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { BlogService, BlogCategory, BlogPostPayload } from '../../../shared/services/blog.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';

@Component({
  selector: 'app-admin-blog-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, AdminSidebarComponent],
  templateUrl: './admin-blog-form.component.html',
  styleUrls: ['./admin-blog-form.component.scss']
})
export class AdminBlogFormComponent implements OnInit {
  private blogService = inject(BlogService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  postId: string | null = null;
  isEditMode = false;

  isLoading = false;
  isSaving = false;
  error: string | null = null;

  categories: { value: BlogCategory; label: string }[] = [
    { value: 'relogios', label: 'Relógios' },
    { value: 'arte', label: 'Arte' },
    { value: 'mercado', label: 'Mercado' },
    { value: 'guias', label: 'Guias' },
    { value: 'bidroom', label: 'BidRoom' }
  ];

  title = '';
  slug = '';
  excerpt = '';
  content = '';
  coverImage = '';
  category: BlogCategory = 'mercado';
  tagsInput = '';
  author = 'BidRoom';
  status: 'draft' | 'published' = 'draft';
  metaDescription = '';

  ngOnInit(): void {
    this.postId = this.route.snapshot.paramMap.get('id');
    this.isEditMode = !!this.postId;
    if (this.isEditMode) this.loadPost();
  }

  private loadPost(): void {
    if (!this.postId) return;
    this.isLoading = true;
    this.error = null;
    this.blogService.getPostByIdAdmin(this.postId).subscribe({
      next: ({ post }) => {
        this.title = post.title;
        this.slug = post.slug;
        this.excerpt = post.excerpt ?? '';
        this.content = post.content;
        this.coverImage = post.coverImage ?? '';
        this.category = post.category;
        this.tagsInput = (post.tags ?? []).join(', ');
        this.author = post.author ?? 'BidRoom';
        this.status = post.status as 'draft' | 'published';
        this.metaDescription = post.metaDescription ?? '';
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to load post';
        this.isLoading = false;
      }
    });
  }

  save(): void {
    if (!this.title.trim() || !this.content.trim()) {
      this.error = 'Título e conteúdo são obrigatórios.';
      return;
    }
    this.isSaving = true;
    this.error = null;

    const payload: BlogPostPayload = {
      title: this.title.trim(),
      slug: this.slug.trim() || undefined,
      excerpt: this.excerpt.trim(),
      content: this.content,
      coverImage: this.coverImage.trim(),
      category: this.category,
      tags: this.tagsInput.split(',').map(t => t.trim()).filter(Boolean),
      author: this.author.trim() || 'BidRoom',
      status: this.status,
      metaDescription: this.metaDescription.trim()
    };

    const req = this.isEditMode && this.postId
      ? this.blogService.updatePost(this.postId, payload)
      : this.blogService.createPost(payload);

    req.subscribe({
      next: () => this.router.navigate(['/nexus/blog']),
      error: (err) => {
        this.isSaving = false;
        this.error = err?.error?.error || err?.message || 'Failed to save post';
      }
    });
  }

  cancel(): void {
    this.router.navigate(['/nexus/blog']);
  }
}
