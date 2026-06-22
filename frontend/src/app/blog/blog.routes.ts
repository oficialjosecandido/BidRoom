import { Routes } from '@angular/router';

export const blogRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/blog-list/blog-list.component').then(m => m.BlogListComponent)
  },
  {
    path: ':slug',
    loadComponent: () => import('./components/blog-post/blog-post.component').then(m => m.BlogPostComponent)
  }
];
