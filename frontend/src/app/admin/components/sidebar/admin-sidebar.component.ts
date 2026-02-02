import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';

interface SidebarItem {
  label: string;
  route: string;
  icon: string;
}

@Component({
  selector: 'app-admin-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './admin-sidebar.component.html',
  styleUrls: ['./admin-sidebar.component.scss']
})
export class AdminSidebarComponent {
  sidebarItems: SidebarItem[] = [
    { label: 'Home', route: '/nexus', icon: '🏠' },
    { label: 'Auctions', route: '/nexus/auctions', icon: '🔨' },
    { label: 'Customers', route: '/nexus/customers', icon: '👥' },
    { label: 'Transactions', route: '/nexus/transactions', icon: '💳' }
  ];

  constructor(private router: Router) {}

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  isActiveRoute(route: string): boolean {
    return this.router.url === route || this.router.url.startsWith(route + '/');
  }
}

