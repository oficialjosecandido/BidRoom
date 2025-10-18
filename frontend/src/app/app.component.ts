import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';
import { MsalService, MsalBroadcastService } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { AuthService } from '@core/services/auth.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'Bidroom';
  isAuthenticated = false;
  private readonly _destroying$ = new Subject<void>();

  constructor(
    private msalService: MsalService,
    private msalBroadcastService: MsalBroadcastService,
    private authService: AuthService
  ) {}

         async ngOnInit(): Promise<void> {
           // Initialize MSAL first
           await this.initializeMsal();

           // Check authentication status
           this.checkAuthStatus();

           // Subscribe to interaction status
           this.msalBroadcastService.inProgress$
             .pipe(
               filter((status: InteractionStatus) => status === InteractionStatus.None),
               takeUntil(this._destroying$)
             )
             .subscribe(() => {
               this.checkAuthStatus();
             });
         }

         private async initializeMsal(): Promise<void> {
           try {
             // Initialize MSAL instance
             await this.msalService.instance.initialize();
             
             // Now that MSAL is initialized, initialize the auth service
             this.authService.initialize();
             
             // Handle any pending redirects after initialization
             const response = await this.msalService.instance.handleRedirectPromise();
             if (response) {
               this.isAuthenticated = true;
             }
           } catch (error) {
             console.error('Failed to initialize MSAL:', error);
           }
         }


  ngOnDestroy(): void {
    this._destroying$.next();
    this._destroying$.complete();
  }

  private checkAuthStatus(): void {
    this.isAuthenticated = this.msalService.instance.getAllAccounts().length > 0;
  }
}

