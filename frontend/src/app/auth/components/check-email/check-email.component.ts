import { Component, inject } from '@angular/core';

import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-check-email',
  standalone: true,
  imports: [],
  templateUrl: './check-email.component.html',
  styleUrls: ['./check-email.component.scss']
})
export class CheckEmailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  email = '';

  constructor() {
    this.email = this.route.snapshot.queryParams['email'] || '';
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }
}
