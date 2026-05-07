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
    loadComponent: () => import('./components/customers/admin-customers.component').then(m => m.AdminCustomersComponent),
    canActivate: [AdminGuard]
  },
  {
    path: 'transactions',
    loadComponent: () => import('./components/transactions/admin-transactions.component').then(m => m.AdminTransactionsComponent),
    canActivate: [AdminGuard]
  },
  {
    path: 'disputes',
    loadComponent: () => import('./components/disputes/admin-disputes.component').then(m => m.AdminDisputesComponent),
    canActivate: [AdminGuard],
    data: { title: 'Disputes', icon: '⚖️' }
  }
];

