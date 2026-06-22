import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';

export type BlogCategory = 'relogios' | 'arte' | 'mercado' | 'guias' | 'bidroom';

export interface BlogPostSummary {
  _id: string;
  title: string;
  slug: string;
  excerpt: string;
  coverImage: string;
  category: BlogCategory;
  tags: string[];
  author: string;
  publishedAt: string | null;
}

export interface BlogPost extends BlogPostSummary {
  content: string;
  metaDescription: string;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BlogPostAdmin extends BlogPostSummary {
  status: 'draft' | 'published';
  createdAt: string;
  updatedAt: string;
}

export interface BlogListResponse {
  posts: BlogPostSummary[];
  total: number;
  page: number;
  pages: number;
}

export interface BlogPostPayload {
  title: string;
  slug?: string;
  excerpt?: string;
  content: string;
  coverImage?: string;
  category?: BlogCategory;
  tags?: string[];
  author?: string;
  status?: 'draft' | 'published';
  metaDescription?: string;
}

@Injectable({ providedIn: 'root' })
export class BlogService {
  private http = inject(HttpClient);
  private apiUrl = `${API_CONFIG.getApiUrl()}/blog`;

  getPosts(page = 1, limit = 12, category?: BlogCategory): Observable<BlogListResponse> {
    let params = new HttpParams().set('page', page).set('limit', limit);
    if (category) params = params.set('category', category);
    return this.http.get<BlogListResponse>(this.apiUrl, { params });
  }

  getPostBySlug(slug: string): Observable<{ post: BlogPost }> {
    return this.http.get<{ post: BlogPost }>(`${this.apiUrl}/${slug}`);
  }

  // Admin
  getAllPostsAdmin(): Observable<{ posts: BlogPostAdmin[] }> {
    return this.http.get<{ posts: BlogPostAdmin[] }>(`${this.apiUrl}/admin/all`);
  }

  getPostByIdAdmin(id: string): Observable<{ post: BlogPost & { status: string } }> {
    return this.http.get<{ post: BlogPost & { status: string } }>(`${this.apiUrl}/admin/${id}`);
  }

  createPost(payload: BlogPostPayload): Observable<{ post: BlogPost }> {
    return this.http.post<{ post: BlogPost }>(this.apiUrl, payload);
  }

  updatePost(id: string, payload: Partial<BlogPostPayload>): Observable<{ post: BlogPost }> {
    return this.http.put<{ post: BlogPost }>(`${this.apiUrl}/${id}`, payload);
  }

  deletePost(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${id}`);
  }
}
