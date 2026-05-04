import { APP_INITIALIZER, ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

import { routes } from './app.routes';
import { authInterceptor } from './auth/interceptors/auth.interceptor';
import { fingerprintInterceptor } from './auth/interceptors/fingerprint.interceptor';
import { AuthService } from './auth/services/auth.service';
import { AuthGuard } from './auth/guards/auth.guard';
import { ThemeService } from './shared/services/theme.service';

function initThemeFactory(theme: ThemeService) {
  return () => {
    theme.initFromStorageSync();
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withInMemoryScrolling({ anchorScrolling: 'enabled' })),
    provideHttpClient(withInterceptors([authInterceptor, fingerprintInterceptor])),
    provideTranslateService({
      defaultLanguage: 'en',
      loader: provideTranslateHttpLoader({ prefix: '/i18n/', suffix: '.json' })
    }),
    provideFirebaseApp(() => initializeApp({
      apiKey: "AIzaSyBb3nk50nwBME8dN5pNhu2W1B7-m35qqHw",
      authDomain: "bidroom-47cb5.firebaseapp.com",
      projectId: "bidroom-47cb5",
      storageBucket: "bidroom-47cb5.firebasestorage.app",
      messagingSenderId: "16761692806",
      appId: "1:16761692806:web:b1e10f2a57a040f8556707",
      measurementId: "G-4FDFR1ZSRV"
    })),
    provideAuth(() => getAuth()),
    AuthService,
    AuthGuard,
    {
      provide: APP_INITIALIZER,
      useFactory: initThemeFactory,
      deps: [ThemeService],
      multi: true
    }
  ]
};
