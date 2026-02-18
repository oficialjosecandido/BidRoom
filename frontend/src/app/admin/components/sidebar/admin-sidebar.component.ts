import { Component, inject } from '@angular/core';

import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../../auth/services/auth.service';

interface SidebarItem {
  label: string;
  route: string;
  icon: string;
}

@Component({
  selector: 'app-admin-sidebar',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './admin-sidebar.component.html',
  styleUrls: ['./admin-sidebar.component.scss']
})
export class AdminSidebarComponent {
  private router = inject(Router);
  private authService = inject(AuthService);

  sidebarItems: SidebarItem[] = [
    { label: 'Home', route: '/nexus', icon: '🏠' },
    { label: 'Auctions', route: '/nexus/auctions', icon: '🔨' },
    { label: 'Customers', route: '/nexus/customers', icon: '👥' },
    { label: 'Transactions', route: '/nexus/transactions', icon: '💳' },
    { label: 'Disputes', route: '/nexus/disputes', icon: '⚖️' }
  ];

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  isActiveRoute(route: string): boolean {
    return this.router.url === route || this.router.url.startsWith(route + '/');
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => this.router.navigate(['/landing']),
      error: () => this.router.navigate(['/landing'])
    });
  }
}

