import { Component, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';

interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: string;
}

@Component({
  selector: 'app-faq',
  standalone: true,
  imports: [FormsModule, HeaderComponent, FooterComponent, TranslateModule],
  templateUrl: './faq.component.html',
  styleUrls: ['./faq.component.scss']
})
export class FaqComponent {
  private router = inject(Router);
  private translate = inject(TranslateService);

  selectedCategory = 'all';
  searchTerm = '';
  expandedItems = new Set<string>();

  get faqItems(): FAQItem[] {
    return [
      // Account & Billing
      { id: 'account-1', question: this.translate.instant('faq.items.account1.q'), answer: this.translate.instant('faq.items.account1.a'), category: 'account' },
      { id: 'account-2', question: this.translate.instant('faq.items.account2.q'), answer: this.translate.instant('faq.items.account2.a'), category: 'account' },
      { id: 'account-3', question: this.translate.instant('faq.items.account3.q'), answer: this.translate.instant('faq.items.account3.a'), category: 'account' },
      { id: 'account-4', question: this.translate.instant('faq.items.account4.q'), answer: this.translate.instant('faq.items.account4.a'), category: 'account' },
      { id: 'account-5', question: this.translate.instant('faq.items.account5.q'), answer: this.translate.instant('faq.items.account5.a'), category: 'account' },
      // Bidding & Auctions
      { id: 'bidding-1', question: this.translate.instant('faq.items.bidding1.q'), answer: this.translate.instant('faq.items.bidding1.a'), category: 'bidding' },
      { id: 'bidding-2', question: this.translate.instant('faq.items.bidding2.q'), answer: this.translate.instant('faq.items.bidding2.a'), category: 'bidding' },
      { id: 'bidding-3', question: this.translate.instant('faq.items.bidding3.q'), answer: this.translate.instant('faq.items.bidding3.a'), category: 'bidding' },
      { id: 'bidding-4', question: this.translate.instant('faq.items.bidding4.q'), answer: this.translate.instant('faq.items.bidding4.a'), category: 'bidding' },
      { id: 'bidding-5', question: this.translate.instant('faq.items.bidding5.q'), answer: this.translate.instant('faq.items.bidding5.a'), category: 'bidding' },
      { id: 'bidding-6', question: this.translate.instant('faq.items.bidding6.q'), answer: this.translate.instant('faq.items.bidding6.a'), category: 'bidding' },
      // Technical Support
      { id: 'technical-1', question: this.translate.instant('faq.items.technical1.q'), answer: this.translate.instant('faq.items.technical1.a'), category: 'technical' },
      { id: 'technical-2', question: this.translate.instant('faq.items.technical2.q'), answer: this.translate.instant('faq.items.technical2.a'), category: 'technical' },
      { id: 'technical-3', question: this.translate.instant('faq.items.technical3.q'), answer: this.translate.instant('faq.items.technical3.a'), category: 'technical' },
      { id: 'technical-4', question: this.translate.instant('faq.items.technical4.q'), answer: this.translate.instant('faq.items.technical4.a'), category: 'technical' },
      { id: 'technical-5', question: this.translate.instant('faq.items.technical5.q'), answer: this.translate.instant('faq.items.technical5.a'), category: 'technical' },
      // Shipping & Returns
      { id: 'shipping-1', question: this.translate.instant('faq.items.shipping1.q'), answer: this.translate.instant('faq.items.shipping1.a'), category: 'shipping' },
      { id: 'shipping-2', question: this.translate.instant('faq.items.shipping2.q'), answer: this.translate.instant('faq.items.shipping2.a'), category: 'shipping' },
      { id: 'shipping-3', question: this.translate.instant('faq.items.shipping3.q'), answer: this.translate.instant('faq.items.shipping3.a'), category: 'shipping' },
      { id: 'shipping-4', question: this.translate.instant('faq.items.shipping4.q'), answer: this.translate.instant('faq.items.shipping4.a'), category: 'shipping' },
      // Security & Trust
      { id: 'security-1', question: this.translate.instant('faq.items.security1.q'), answer: this.translate.instant('faq.items.security1.a'), category: 'security' },
      { id: 'security-2', question: this.translate.instant('faq.items.security2.q'), answer: this.translate.instant('faq.items.security2.a'), category: 'security' },
      { id: 'security-3', question: this.translate.instant('faq.items.security3.q'), answer: this.translate.instant('faq.items.security3.a'), category: 'security' },
    ];
  }

  get filteredFAQs(): FAQItem[] {
    let filtered = this.faqItems;

    // Filter by category
    if (this.selectedCategory !== 'all') {
      filtered = filtered.filter(item => item.category === this.selectedCategory);
    }

    // Filter by search term
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(item => 
        item.question.toLowerCase().includes(term) || 
        item.answer.toLowerCase().includes(term)
      );
    }

    return filtered;
  }

  toggleExpanded(itemId: string): void {
    if (this.expandedItems.has(itemId)) {
      this.expandedItems.delete(itemId);
    } else {
      this.expandedItems.add(itemId);
    }
  }

  isExpanded(itemId: string): boolean {
    return this.expandedItems.has(itemId);
  }

  getCategoryName(category: string): string {
    const keyMap: Record<string, string> = {
      'all': 'faq.categories.all',
      'account': 'faq.categories.account',
      'bidding': 'faq.categories.bidding',
      'technical': 'faq.categories.technical',
      'shipping': 'faq.categories.shipping',
      'security': 'faq.categories.security'
    };
    return this.translate.instant(keyMap[category] || category);
  }

  navigateToHome(): void {
    this.router.navigate(['/landing']);
  }

  navigateToContact(): void {
    this.router.navigate(['/landing/contact']);
  }
}
