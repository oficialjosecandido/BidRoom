import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';

import { routes } from './app.routes';
import { authInterceptor } from './auth/interceptors/auth.interceptor';
import { AuthService } from './auth/services/auth.service';
import { AuthGuard } from './auth/guards/auth.guard';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideFirebaseApp(() => initializeApp({
      apiKey: "AIzaSyDsmGTShUTb_C3C7vhzVQcDhUGuhXDHj00",
      authDomain: "auction-80ee4.firebaseapp.com",
      projectId: "auction-80ee4",
      storageBucket: "auction-80ee4.firebasestorage.app",
      messagingSenderId: "455744128769",
      appId: "1:455744128769:web:154fbbd3e27aee79ac3d00"
    })),
    provideAuth(() => getAuth()),
    AuthService,
    AuthGuard
  ]
};
