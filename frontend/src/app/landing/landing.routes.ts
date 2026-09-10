import { Routes } from '@angular/router';

export const landingRoutes: Routes = [
  // The homepage moved to the domain root; /landing is kept as an alias so
  // existing links and the many router.navigate(['/landing']) calls still work.
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
