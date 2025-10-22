import { Routes } from '@angular/router';

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
  // TODO: Add protected routes with AuthGuard
  // { path: 'dashboard', loadComponent: () => import('./components/dashboard/dashboard.component').then(m => m.DashboardComponent), canActivate: [AuthGuard] },
  { path: '**', redirectTo: '/landing' }
];
