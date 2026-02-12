import { Component } from '@angular/core';

import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-check-email',
  standalone: true,
  imports: [],
  templateUrl: './check-email.component.html',
  styleUrls: ['./check-email.component.scss']
})
export class CheckEmailComponent {
  email = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.email = this.route.snapshot.queryParams['email'] || '';
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }
}
