import { APP_INITIALIZER, ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideClientHydration, withEventReplay, withHttpTransferCacheOptions } from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { authInterceptor } from './auth/interceptors/auth.interceptor';
import { fingerprintInterceptor } from './auth/interceptors/fingerprint.interceptor';
import { AuthService } from './auth/services/auth.service';
import { AuthGuard } from './auth/guards/auth.guard';
import { ThemeService } from './shared/services/theme.service';

/** Language the app boots in. On the server there is no localStorage, so 'pt'. */
const DEFAULT_LANG = 'pt';
const FALLBACK_LANG = 'en';

function activeLang(): string {
  return typeof localStorage !== 'undefined'
    ? (localStorage.getItem('lang') || DEFAULT_LANG)
    : DEFAULT_LANG;
}

function initThemeFactory(theme: ThemeService) {
  return () => {
    theme.initFromStorageSync();
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    // Without this the client throws away the SSR'd DOM and re-renders from
    // scratch, so server rendering bought nothing. Event replay queues clicks
    // that land before hydration finishes; the transfer cache inlines the GET
    // responses made during SSR so the browser does not repeat them.
    provideClientHydration(
      withEventReplay(),
      withHttpTransferCacheOptions({
        includePostRequests: false,
        // ngx-translate fetches both the active language and the fallback
        // during SSR. Inlining both put ~390 kB of JSON (over 110 kB gzipped)
        // into every document, dwarfing the rendered markup. Only the language
        // actually rendered is worth carrying; the fallback is fetched by the
        // browser on demand, from cache, off the critical path.
        filter: req =>
          !req.url.includes('/i18n/') ||
          req.url.includes(`/i18n/${DEFAULT_LANG}.json`),
      }),
    ),
    provideRouter(routes, withInMemoryScrolling({ anchorScrolling: 'enabled' })),
    provideHttpClient(withInterceptors([authInterceptor, fingerprintInterceptor])),
    provideTranslateService({
      fallbackLang: FALLBACK_LANG,
      lang: activeLang(),
      loader: provideTranslateHttpLoader({ prefix: '/i18n/', suffix: '.json' })
    }),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    AuthService,
    AuthGuard,
    {
      provide: APP_INITIALIZER,
      useFactory: initThemeFactory,
      deps: [ThemeService],
      multi: true
    },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ]
};
