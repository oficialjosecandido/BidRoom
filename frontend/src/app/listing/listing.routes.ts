import { Routes } from '@angular/router';

export const listingRoutes: Routes = [
  {
    path: '',
    redirectTo: 'list',
    pathMatch: 'full'
  },
  {
    path: 'categories',
    loadComponent: () => import('./components/categories/categories.component').then(m => m.CategoriesComponent)
  },
  {
    path: 'list',
    loadComponent: () => import('./components/listing-list/listing-list.component').then(m => m.ListingListComponent)
  },
  {
    path: 'add',
    loadComponent: () => import('./components/add-listing/add-listing').then(m => m.AddListing)
  },
  {
    path: ':slug/choose-winner',
    loadComponent: () => import('./components/listing-details/listing-details.component').then(m => m.ListingDetailsComponent)
  },
  {
    path: ':slug',
    loadComponent: () => import('./components/listing-details/listing-details.component').then(m => m.ListingDetailsComponent)
  }
];

