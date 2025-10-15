import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

// Core Module
import { CoreModule } from './core/core.module';

// Shared Module
import { SharedModule } from './shared/shared.module';

// MSAL (Azure AD B2C)
import { MsalModule, MsalInterceptor, MsalGuard, MsalRedirectComponent } from '@azure/msal-angular';
import { PublicClientApplication, InteractionType } from '@azure/msal-browser';
import { environment } from '@environments/environment';

const msalInstance = new PublicClientApplication({
  auth: {
    clientId: environment.azureAdB2C.clientId,
    authority: environment.azureAdB2C.authority,
    redirectUri: environment.azureAdB2C.redirectUri,
    postLogoutRedirectUri: environment.azureAdB2C.postLogoutRedirectUri,
    knownAuthorities: environment.azureAdB2C.knownAuthorities,
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
});

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    AppRoutingModule,
    CoreModule,
    SharedModule,
    MsalModule.forRoot(
      msalInstance,
      {
        interactionType: InteractionType.Redirect,
        authRequest: {
          scopes: ['openid', 'profile', 'email'],
        },
      },
      {
        interactionType: InteractionType.Redirect,
        protectedResourceMap: new Map([
          [environment.apiUrl, ['openid', 'profile', 'email']],
        ]),
      }
    ),
  ],
  providers: [
    {
      provide: HTTP_INTERCEPTORS,
      useClass: MsalInterceptor,
      multi: true,
    },
    MsalGuard,
  ],
  bootstrap: [AppComponent, MsalRedirectComponent],
})
export class AppModule {}

