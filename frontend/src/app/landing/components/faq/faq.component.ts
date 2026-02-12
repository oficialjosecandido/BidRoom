import { Component, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
  imports: [FormsModule, HeaderComponent, FooterComponent],
  templateUrl: './faq.component.html',
  styleUrls: ['./faq.component.scss']
})
export class FaqComponent {
  private router = inject(Router);

  selectedCategory = 'all';
  searchTerm = '';
  expandedItems = new Set<string>();

  faqItems: FAQItem[] = [
    // Account & Billing
    {
      id: 'account-1',
      question: 'How do I create an account?',
      answer: 'Creating an account is free and easy! Click the "Start Bidding" button on our homepage, fill out the registration form with your email and password, and verify your email address. You\'ll be ready to start bidding in minutes.',
      category: 'account'
    },
    {
      id: 'account-2',
      question: 'Is it free to create an account?',
      answer: 'Yes, creating an account on BidRoom is completely free. You only pay when you win an auction and need to complete your purchase.',
      category: 'account'
    },
    {
      id: 'account-3',
      question: 'What payment methods do you accept?',
      answer: 'We accept all major credit cards (Visa, MasterCard, American Express), PayPal, and bank transfers. All payments are processed securely through our encrypted payment system.',
      category: 'account'
    },
    {
      id: 'account-4',
      question: 'How do I update my payment information?',
      answer: 'You can update your payment information at any time by going to your account settings. Click on "Payment Methods" and add or update your preferred payment options.',
      category: 'account'
    },
    {
      id: 'account-5',
      question: 'Can I cancel my account?',
      answer: 'Yes, you can deactivate your account at any time through your account settings. Please note that you cannot cancel active bids or ongoing auctions.',
      category: 'account'
    },

    // Bidding & Auctions
    {
      id: 'bidding-1',
      question: 'How does the bidding system work?',
      answer: 'Our proxy bidding system allows you to set your maximum bid amount. We automatically bid on your behalf up to that amount, ensuring you only pay the minimum needed to win.',
      category: 'bidding'
    },
    {
      id: 'bidding-2',
      question: 'Can I cancel a bid?',
      answer: 'You can cancel a bid within 1 hour of placement, as long as the auction hasn\'t ended. After that, bids are final and cannot be cancelled.',
      category: 'bidding'
    },
    {
      id: 'bidding-3',
      question: 'How do I know if I won an auction?',
      answer: 'You\'ll receive an email notification immediately when you win an auction. You can also check your account dashboard for all your winning bids.',
      category: 'bidding'
    },
    {
      id: 'bidding-4',
      question: 'What happens if I don\'t pay for a won auction?',
      answer: 'If you don\'t complete payment within 48 hours of winning, the auction will be offered to the next highest bidder. Repeated non-payment may result in account suspension.',
      category: 'bidding'
    },
    {
      id: 'bidding-5',
      question: 'Can I bid on multiple items at once?',
      answer: 'Yes, you can bid on as many items as you want simultaneously. Just make sure you have sufficient funds to cover all potential wins.',
      category: 'bidding'
    },
    {
      id: 'bidding-6',
      question: 'How do I track my bids?',
      answer: 'You can track all your bids in your account dashboard. You\'ll see active bids, winning bids, and bid history all in one place.',
      category: 'bidding'
    },

    // Technical Support
    {
      id: 'technical-1',
      question: 'The website is loading slowly. What should I do?',
      answer: 'Try refreshing your browser or clearing your cache. If the problem persists, check your internet connection or try using a different browser.',
      category: 'technical'
    },
    {
      id: 'technical-2',
      question: 'I can\'t log into my account. Help!',
      answer: 'First, make sure you\'re using the correct email and password. If you\'ve forgotten your password, use the "Forgot Password" link on the login page.',
      category: 'technical'
    },
    {
      id: 'technical-3',
      question: 'Do you have a mobile app?',
      answer: 'Yes! Our mobile app is available for both iOS and Android devices. You can download it from the App Store or Google Play Store.',
      category: 'technical'
    },
    {
      id: 'technical-4',
      question: 'Why am I not receiving email notifications?',
      answer: 'Check your spam folder first. If notifications are still missing, go to your account settings and verify your email preferences are enabled.',
      category: 'technical'
    },
    {
      id: 'technical-5',
      question: 'Can I use BidRoom on my tablet?',
      answer: 'Absolutely! BidRoom is fully responsive and works great on tablets, smartphones, and desktop computers.',
      category: 'technical'
    },

    // Shipping & Returns
    {
      id: 'shipping-1',
      question: 'How is shipping handled?',
      answer: 'Shipping is handled by individual sellers. Each listing will show shipping costs and estimated delivery times. Most sellers ship within 1-3 business days.',
      category: 'shipping'
    },
    {
      id: 'shipping-2',
      question: 'Can I return an item if I\'m not satisfied?',
      answer: 'Return policies vary by seller. Check the individual listing for return information. BidRoom also offers buyer protection for eligible purchases.',
      category: 'shipping'
    },
    {
      id: 'shipping-3',
      question: 'Do you ship internationally?',
      answer: 'International shipping depends on the individual seller. Check each listing for shipping options to your country.',
      category: 'shipping'
    },
    {
      id: 'shipping-4',
      question: 'How do I track my shipment?',
      answer: 'Once your item ships, you\'ll receive a tracking number via email. You can use this to track your package on the carrier\'s website.',
      category: 'shipping'
    },

    // Security & Trust
    {
      id: 'security-1',
      question: 'Is my personal information secure?',
      answer: 'Yes, we use industry-standard encryption to protect your personal and payment information. We never share your data with third parties without your consent.',
      category: 'security'
    },
    {
      id: 'security-2',
      question: 'What is buyer protection?',
      answer: 'Our buyer protection program covers eligible purchases against fraud, misrepresentation, and non-delivery. Check our terms for full details.',
      category: 'security'
    },
    {
      id: 'security-3',
      question: 'How do I report a suspicious listing?',
      answer: 'If you see a suspicious listing, click the "Report" button on the item page or contact our support team immediately.',
      category: 'security'
    }
  ];

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
    const categoryNames: Record<string, string> = {
      'all': 'All Questions',
      'account': 'Account & Billing',
      'bidding': 'Bidding & Auctions',
      'technical': 'Technical Support',
      'shipping': 'Shipping & Returns',
      'security': 'Security & Trust'
    };
    return categoryNames[category] || category;
  }

  navigateToHome(): void {
    this.router.navigate(['/landing']);
  }

  navigateToContact(): void {
    this.router.navigate(['/landing/contact']);
  }
}
