import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LegalLayoutComponent } from '../legal/legal-layout.component';

/**
 * The public "Prohibited and restricted items" policy. Clause 18 of the Terms
 * incorporates it by reference, so the two must not drift: a group added here
 * belongs in the Terms' scope, and a group removed stops being enforceable.
 *
 * The prohibition groups are flagged for review by PROHIBITED_PATTERNS in
 * backend/src/utils/contentFilter.js, which points a reviewer at a listing and
 * never refuses one. The restricted groups deliberately have no keyword rule:
 * they are conditions a person verifies against documents.
 */
@Component({
  selector: 'app-prohibited-items',
  standalone: true,
  imports: [LegalLayoutComponent, TranslateModule],
  templateUrl: './prohibited-items.component.html',
  styleUrls: ['../legal/_legal-content.scss']
})
export class ProhibitedItemsComponent {
  /** Each group is a title plus its bullets, so the template stays a loop. */
  readonly prohibitedGroups = [
    { key: 'g1', items: 2, note: true },
    { key: 'g2', items: 4, note: true },
    { key: 'g3', items: 2, note: false },
    { key: 'g4', items: 3, note: true },
    { key: 'g5', items: 4, note: false },
    { key: 'g6', items: 1, note: false },
    { key: 'g7', items: 3, note: false },
    { key: 'g8', items: 5, note: false },
    { key: 'g9', items: 4, note: false }
  ].map(g => ({ ...g, lis: Array.from({ length: g.items }, (_, i) => i + 1) }));

  readonly restrictedGroups = [
    { key: 'g1', items: 3 },
    { key: 'g2', items: 3 },
    { key: 'g3', items: 1 },
    { key: 'g4', items: 2 },
    { key: 'g5', items: 3 },
    { key: 'g6', items: 1 },
    { key: 'g7', items: 1 },
    { key: 'g8', items: 1 },
    { key: 'g9', items: 2 }
  ].map(g => ({ ...g, lis: Array.from({ length: g.items }, (_, i) => i + 1) }));

  readonly listingRules = [1, 2, 3, 4, 5];
  readonly enforcementTiers = [1, 2, 3, 4];
}
