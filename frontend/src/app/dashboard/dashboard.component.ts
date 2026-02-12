import { Component, inject } from '@angular/core';

import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../auth/services/auth.service';

const STORAGE_KEY = 'bidroom-dashboard-sidebar-collapsed';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  sidebarCollapsed = false;

  constructor() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      this.sidebarCollapsed = stored === 'true';
    }
  }

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    localStorage.setItem(STORAGE_KEY, String(this.sidebarCollapsed));
  }

  navigateToLanding(): void {
    this.router.navigate(['/landing']);
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => {
        this.router.navigate(['/landing']);
      }
    });
  }
}

