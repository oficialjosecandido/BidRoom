import { Component, OnInit } from '@angular/core';

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
  pageTitle: string = 'Page';
  pageIcon: string = '📄';

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    // Get page title and icon from route data
    const routeData = this.route.snapshot.data;
    this.pageTitle = routeData['title'] || 'Page';
    this.pageIcon = routeData['icon'] || '📄';
  }
}

