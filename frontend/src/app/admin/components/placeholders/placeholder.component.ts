import { Component, OnInit, inject } from '@angular/core';

import { ActivatedRoute } from '@angular/router';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';

@Component({
  selector: 'app-placeholder',
  standalone: true,
  imports: [AdminSidebarComponent],
  templateUrl: './placeholder.component.html',
  styleUrls: ['./placeholder.component.scss']
})
export class PlaceholderComponent implements OnInit {
  private route = inject(ActivatedRoute);

  pageTitle = 'Page';
  pageIcon = '📄';

  ngOnInit(): void {
    // Get page title and icon from route data
    const routeData = this.route.snapshot.data;
    this.pageTitle = routeData['title'] || 'Page';
    this.pageIcon = routeData['icon'] || '📄';
  }
}

