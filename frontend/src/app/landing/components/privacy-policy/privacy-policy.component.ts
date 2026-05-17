import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LegalLayoutComponent } from '../legal/legal-layout.component';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [LegalLayoutComponent, TranslateModule],
  templateUrl: './privacy-policy.component.html',
  styleUrls: ['../legal/_legal-content.scss']
})
export class PrivacyPolicyComponent {}
