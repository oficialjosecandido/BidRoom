import { Routes } from '@angular/router';

export const landingRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'how-it-works',
    loadComponent: () => import('./components/how-it-works/how-it-works.component').then(m => m.HowItWorksComponent)
  },
  {
    path: 'contact',
    loadComponent: () => import('./components/contact/contact.component').then(m => m.ContactComponent)
  },
  {
    path: 'faq',
    loadComponent: () => import('./components/faq/faq.component').then(m => m.FaqComponent)
  }
];
