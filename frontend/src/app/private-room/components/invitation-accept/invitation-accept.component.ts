import { Component, OnInit, inject } from '@angular/core';

import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { API_CONFIG } from '../../../shared/config/api.config';

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

  token = '';
  listingId = '';
  action: 'accept' | 'decline' | null = null;
  isLoading = true;
  success = false;
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

  acceptInvitation(): void {
    const apiUrl = `${API_CONFIG.getApiUrl()}/private-room/invitation/accept`;
    
    this.http.post(apiUrl, {
      token: this.token,
      listingId: this.listingId
    }).subscribe({
      next: () => {
        this.success = true;
        this.isLoading = false;
        
        // Redirect to private room after 2 seconds
        setTimeout(() => {
          this.router.navigate(['/private-room/auction', this.listingId]);
        }, 2000);
      },
      error: (error) => {
        this.error = error?.error?.message || 'Failed to accept invitation. The invitation may have expired or already been processed.';
        this.isLoading = false;
      }
    });
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
        // Could redirect to listing page or dashboard
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
      this.router.navigate(['/private-room/auction', this.listingId]);
    } else {
      this.router.navigate(['/listing/list']);
    }
  }
}

