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
      { path: '', redirectTo: 'my-account', pathMatch: 'full' },
      { 
        path: 'my-account', 
        loadComponent: () => import('./dashboard/components/my-account/my-account.component').then(m => m.MyAccountComponent)
      },
      {
        path: 'my-auctions',
        loadComponent: () => import('./dashboard/components/my-auctions/my-auctions.component').then(m => m.MyAuctionsComponent)
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
