import { Routes } from '@angular/router';
import { AuthGuard } from './auth/guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/landing', pathMatch: 'full' },
  { 
    path: 'auth', 
    loadChildren: () => import('./auth/auth.module').then(m => m.AuthModule)
  },
  {
    path: 'landing',
    loadChildren: () => import('./landing/landing.module').then(m => m.LandingModule)
  },
  {
    path: 'listing',
    loadChildren: () => import('./listing/listing.routes').then(r => r.listingRoutes)
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [AuthGuard],
    children: [
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      {
        path: 'home',
        loadComponent: () => import('./dashboard/components/home/dashboard-home.component').then(m => m.DashboardHomeComponent)
      },
      { 
        path: 'my-account', 
        loadComponent: () => import('./dashboard/components/my-account/my-account.component').then(m => m.MyAccountComponent)
      },
      {
        path: 'my-listings',
        loadComponent: () => import('./dashboard/components/my-auctions/my-auctions.component').then(m => m.MyAuctionsComponent)
      },
      {
        path: 'my-auctions',
        loadComponent: () => import('./dashboard/components/my-auctions-bidder/my-auctions-bidder.component').then(m => m.MyAuctionsBidderComponent)
      },
      {
        path: 'transactions',
        loadComponent: () => import('./dashboard/components/transactions/dashboard-transactions.component').then(m => m.DashboardTransactionsComponent)
      },
      {
        path: 'disputes',
        loadComponent: () => import('./dashboard/components/disputes/dashboard-disputes.component').then(m => m.DashboardDisputesComponent)
      },
      {
        path: 'watchlist',
        loadComponent: () => import('./dashboard/components/watchlist/dashboard-watchlist.component').then(m => m.DashboardWatchlistComponent)
      },
      {
        path: 'notifications',
        loadComponent: () => import('./dashboard/components/notifications/dashboard-notifications.component').then(m => m.DashboardNotificationsComponent)
      }
    ]
  },
  {
    path: 'nexus',
    loadChildren: () => import('./admin/admin.module').then(m => m.AdminModule)
  },
  {
    path: 'private-room',
    loadChildren: () => import('./private-room/private-room.module').then(m => m.PrivateRoomModule)
  },
  { path: '**', redirectTo: '/landing' }
];
