import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LegalLayoutComponent } from '../legal/legal-layout.component';

@Component({
  selector: 'app-terms-conditions',
  standalone: true,
  imports: [LegalLayoutComponent, TranslateModule],
  templateUrl: './terms-conditions.component.html',
  styleUrls: ['../legal/_legal-content.scss']
})
export class TermsConditionsComponent {}
