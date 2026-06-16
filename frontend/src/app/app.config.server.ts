import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // SSR must use fetch-based HttpClient (no XMLHttpRequest on Node)
    provideHttpClient(withFetch()),
  ]
};

export const AppServerConfig = mergeApplicationConfig(appConfig, serverConfig);
