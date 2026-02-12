import { Component, OnInit } from '@angular/core';

import { Router } from '@angular/router';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [HeaderComponent, FooterComponent],
  templateUrl: './privacy-policy.component.html',
  styleUrls: ['./privacy-policy.component.scss']
})
export class PrivacyPolicyComponent implements OnInit {
  
  constructor(private router: Router) {}

  ngOnInit(): void {}

  navigateToHome(): void {
    this.router.navigate(['/landing']);
  }
}
