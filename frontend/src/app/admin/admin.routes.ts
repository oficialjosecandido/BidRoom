import { Routes } from '@angular/router';
import { AdminGuard } from './guards/admin.guard';

export const adminRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/dashboard/admin-dashboard.component').then(m => m.AdminDashboardComponent),
    canActivate: [AdminGuard]
  },
  {
    path: 'auctions',
    loadComponent: () => import('./components/auctions/admin-auctions.component').then(m => m.AdminAuctionsComponent),
    canActivate: [AdminGuard]
  },
  {
    path: 'auctions/:id',
    loadComponent: () => import('./components/auction-details/admin-auction-details.component').then(m => m.AdminAuctionDetailsComponent),
    canActivate: [AdminGuard]
  },
  {
    path: 'customers',
    loadComponent: () => import('./components/placeholders/placeholder.component').then(m => m.PlaceholderComponent),
    canActivate: [AdminGuard],
    data: { title: 'Customers', icon: '👥' }
  },
  {
    path: 'transactions',
    loadComponent: () => import('./components/placeholders/placeholder.component').then(m => m.PlaceholderComponent),
    canActivate: [AdminGuard],
    data: { title: 'Transactions', icon: '💳' }
  },
  {
    path: 'disputes',
    loadComponent: () => import('./components/disputes/admin-disputes.component').then(m => m.AdminDisputesComponent),
    canActivate: [AdminGuard],
    data: { title: 'Disputes', icon: '⚖️' }
  }
];

