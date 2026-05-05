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
        path: 'buyer',
        loadComponent: () => import('./dashboard/components/buyer-profile/buyer-profile.component').then(m => m.BuyerProfileComponent)
      },
      {
        path: 'seller',
        loadComponent: () => import('./dashboard/components/seller-profile/seller-profile.component').then(m => m.SellerProfileComponent)
      },
      {
        path: 'disputes',
        loadComponent: () => import('./dashboard/components/disputes/dashboard-disputes.component').then(m => m.DashboardDisputesComponent)
      },
      {
        path: 'notifications',
        loadComponent: () => import('./dashboard/components/notifications/dashboard-notifications.component').then(m => m.DashboardNotificationsComponent)
      },
      {
        path: 'settings',
        loadComponent: () => import('./dashboard/components/dashboard-settings/dashboard-settings.component').then(m => m.DashboardSettingsComponent)
      },
      {
        path: 'following',
        loadComponent: () => import('./dashboard/components/following/dashboard-following.component').then(m => m.DashboardFollowingComponent)
      },
      {
        path: 'analytics',
        loadComponent: () => import('./dashboard/components/seller-analytics/seller-analytics.component').then(m => m.SellerAnalyticsComponent)
      },
      // Legacy redirects so old links still work
      { path: 'my-account', redirectTo: 'settings', pathMatch: 'full' },
      { path: 'my-bets', redirectTo: 'buyer', pathMatch: 'full' },
      { path: 'watchlist', redirectTo: 'buyer', pathMatch: 'full' },
      { path: 'transactions', redirectTo: 'buyer', pathMatch: 'full' },
      { path: 'my-listings', redirectTo: 'seller', pathMatch: 'full' },
      { path: 'my-auctions', redirectTo: 'seller', pathMatch: 'full' }
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
  {
    path: 'seller/:id',
    loadComponent: () => import('./profile/seller-public-profile.component').then(m => m.SellerPublicProfileComponent)
  },
  {
    path: 'notifications/unsubscribe',
    loadComponent: () => import('./notifications/unsubscribe.component').then(m => m.UnsubscribeComponent)
  },
  { path: '**', redirectTo: '/landing' }
];
