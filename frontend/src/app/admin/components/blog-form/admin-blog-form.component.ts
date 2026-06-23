import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { BlogService, BlogCategory, BlogPostPayload } from '../../../shared/services/blog.service';
import { API_CONFIG } from '../../../shared/config/api.config';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];

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
  private http = inject(HttpClient);

  isUploadingCover = false;
  uploadError: string | null = null;

  postId: string | null = null;
  isEditMode = false;
  originalSlug = '';

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
  titleEn = '';
  slug = '';
  excerpt = '';
  excerptEn = '';
  content = '';
  contentEn = '';
  coverImage = '';
  category: BlogCategory = 'mercado';
  tagsInput = '';
  author = 'BidRoom';
  status: 'draft' | 'published' = 'draft';
  metaDescription = '';
  metaDescriptionEn = '';

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
        this.titleEn = post.titleEn ?? '';
        this.slug = post.slug;
        this.originalSlug = post.slug;
        this.excerpt = post.excerpt ?? '';
        this.excerptEn = post.excerptEn ?? '';
        this.content = post.content;
        this.contentEn = post.contentEn ?? '';
        this.coverImage = post.coverImage ?? '';
        this.category = post.category;
        this.tagsInput = (post.tags ?? []).join(', ');
        this.author = post.author ?? 'BidRoom';
        this.status = post.status as 'draft' | 'published';
        this.metaDescription = post.metaDescription ?? '';
        this.metaDescriptionEn = post.metaDescriptionEn ?? '';
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
      titleEn: this.titleEn.trim(),
      slug: this.resolveSlugForSave(),
      excerpt: this.excerpt.trim(),
      excerptEn: this.excerptEn.trim(),
      content: this.content,
      contentEn: this.contentEn.trim(),
      coverImage: this.coverImage.trim(),
      category: this.category,
      tags: this.tagsInput.split(',').map(t => t.trim()).filter(Boolean),
      author: this.author.trim() || 'BidRoom',
      status: this.status,
      metaDescription: this.metaDescription.trim(),
      metaDescriptionEn: this.metaDescriptionEn.trim()
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

  private resolveSlugForSave(): string | undefined {
    const current = this.slug.trim();
    const englishSlug = this.slugify(this.titleEn);
    if (!englishSlug) return current || undefined;

    const portugueseSlug = this.slugify(this.title);
    const userChangedSlug = !!current && current !== this.originalSlug && current !== portugueseSlug;
    return userChangedSlug ? current : englishSlug;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async onCoverFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      this.uploadError = 'Formato inválido. Usa JPEG, PNG, GIF, WebP ou BMP.';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.uploadError = 'A imagem excede o limite de 5MB.';
      return;
    }

    this.isUploadingCover = true;
    this.uploadError = null;
    try {
      const formData = new FormData();
      formData.append('images', file);
      const res = await firstValueFrom(
        this.http.post<{ urls: string[] }>(`${API_CONFIG.getApiUrl()}/uploads`, formData)
      );
      this.coverImage = res.urls?.[0] ?? this.coverImage;
    } catch (err: any) {
      this.uploadError = err?.error?.message || err?.error?.error || 'Falha ao enviar a imagem.';
    } finally {
      this.isUploadingCover = false;
    }
  }
}
