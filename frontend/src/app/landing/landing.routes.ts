import { Routes } from '@angular/router';

export const landingRoutes: Routes = [
  // Exact /landing is 301'd to / at the Express/SWA layer. This client redirect
  // remains as a fallback for SPA navigations that still hit the landing module.
  { path: '', redirectTo: '/', pathMatch: 'full' },
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
  },
  {
    path: 'privacy-policy',
    loadComponent: () => import('./components/privacy-policy/privacy-policy.component').then(m => m.PrivacyPolicyComponent)
  },
  {
    path: 'cookies',
    loadComponent: () => import('./components/cookies-policy/cookies-policy.component').then(m => m.CookiesPolicyComponent)
  },
  {
    path: 'terms-conditions',
    loadComponent: () => import('./components/terms-conditions/terms-conditions.component').then(m => m.TermsConditionsComponent)
  },
  {
    path: 'trust',
    loadComponent: () => import('./components/trust/trust.component').then(m => m.TrustComponent)
  }
];
