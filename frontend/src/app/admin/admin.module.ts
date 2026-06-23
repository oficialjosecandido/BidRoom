import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { adminRoutes } from './admin.routes';

// HttpClientModule is intentionally NOT imported here — it would register a
// second, module-scoped HttpClient for everything lazy-loaded under /nexus
// that injects HttpClient directly, bypassing the auth interceptor
// configured via provideHttpClient() in app.config.ts (root injector).
// Components/services should keep injecting HttpClient as-is; it resolves
// to the root instance as long as nothing here re-provides it.
@NgModule({
  imports: [
    CommonModule,
    RouterModule.forChild(adminRoutes)
  ]
})
export class AdminModule { }

