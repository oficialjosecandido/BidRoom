import { Component, OnInit, inject } from '@angular/core';

import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { API_CONFIG } from '../../../shared/config/api.config';
import { AuthService } from '../../../auth/services/auth.service';

@Component({
  selector: 'app-invitation-accept',
  standalone: true,
  imports: [],
  templateUrl: './invitation-accept.component.html',
  styleUrls: ['./invitation-accept.component.scss']
})
export class InvitationAcceptComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);
  authService = inject(AuthService);

  token = '';
  listingId = '';
  action: 'accept' | 'decline' | null = null;
  isLoading = true;
  success = false;
  expired = false;
  error: string | null = null;

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      this.token = params['token'] || '';
      this.listingId = params['listingId'] || '';

      // Determine action from route path
      const url = this.router.url;
      if (url.includes('/invitation/accept')) {
        this.action = 'accept';
      } else if (url.includes('/invitation/decline')) {
        this.action = 'decline';
      } else {
        this.action = params['action'] === 'decline' ? 'decline' : 'accept';
      }

      if (!this.token || !this.listingId) {
        this.error = 'Invalid invitation link. Missing required parameters.';
        this.isLoading = false;
        return;
      }

      if (this.action === 'accept') {
        this.acceptInvitation();
      } else {
        this.declineInvitation();
      }
    });
  }

  private get privateRoomUrl(): string {
    return `/private-room/auction/${this.listingId}`;
  }

  acceptInvitation(): void {
    const apiUrl = `${API_CONFIG.getApiUrl()}/private-room/invitation/accept`;

    this.http.post(apiUrl, {
      token: this.token,
      listingId: this.listingId
    }).subscribe({
      next: () => {
        this.success = true;
        this.isLoading = false;

        // Wait briefly so the user sees the success message, then navigate
        setTimeout(() => {
          this.navigateAfterAccept();
        }, 2000);
      },
      error: (err) => {
        const body = err?.error || {};
        if (body.error === 'Invitation expired') {
          this.expired = true;
        }
        this.error = body.message || 'Failed to accept invitation. The invitation may have expired or already been processed.';
        this.isLoading = false;
      }
    });
  }

  private navigateAfterAccept(): void {
    const user = this.authService.getCurrentUser();
    if (user) {
      this.router.navigate(['/private-room/auction', this.listingId]);
    } else {
      this.router.navigate(['/auth/login'], {
        queryParams: { returnUrl: this.privateRoomUrl }
      });
    }
  }

  declineInvitation(): void {
    const apiUrl = `${API_CONFIG.getApiUrl()}/private-room/invitation/decline`;

    this.http.post(apiUrl, {
      token: this.token,
      listingId: this.listingId
    }).subscribe({
      next: () => {
        this.success = true;
        this.isLoading = false;
        setTimeout(() => {
          this.router.navigate(['/listing/list']);
        }, 2000);
      },
      error: (error) => {
        this.error = error?.error?.message || 'Failed to decline invitation.';
        this.isLoading = false;
      }
    });
  }

  goToPrivateRoom(): void {
    if (this.listingId) {
      this.navigateAfterAccept();
    } else {
      this.router.navigate(['/listing/list']);
    }
  }

  goToListings(): void {
    this.router.navigate(['/listing/list']);
  }
}
