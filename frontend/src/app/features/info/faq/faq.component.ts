import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

interface FAQ {
  id: number;
  question: string;
  answer: string;
  category: string;
  isOpen: boolean;
}

interface Category {
  id: string;
  name: string;
}

@Component({
  selector: 'app-faq',
  templateUrl: './faq.component.html',
  styleUrls: ['./faq.component.scss']
})
export class FaqComponent implements OnInit {
  searchQuery = '';
  selectedCategory = 'all';
  filteredFAQs: FAQ[] = [];
  
  categories: Category[] = [
    { id: 'all', name: 'All' },
    { id: 'bidding', name: 'Bidding' },
    { id: 'selling', name: 'Selling' },
    { id: 'account', name: 'Account' },
    { id: 'payments', name: 'Payments' },
    { id: 'verification', name: 'Verification' },
    { id: 'shipping', name: 'Shipping' },
    { id: 'disputes', name: 'Disputes' }
  ];

  faqs: FAQ[] = [
    // Bidding FAQs
    {
      id: 1,
      question: 'How do I place a bid?',
      answer: 'To place a bid, simply click the "BID NOW" button on any auction listing. You\'ll need to be registered and have payment authorization set up. Enter your maximum bid amount and we\'ll automatically bid on your behalf up to that limit.',
      category: 'bidding',
      isOpen: false
    },
    {
      id: 2,
      question: 'What is the Private Room?',
      answer: 'The Private Room is an exclusive bidding area for the top 5 bidders when an auction reaches 15+ participants. It features extended bidding with 1-minute extensions per bid, creating more excitement and fair competition among serious bidders.',
      category: 'bidding',
      isOpen: false
    },
    {
      id: 3,
      question: 'Can I retract a bid?',
      answer: 'Bids cannot be retracted once placed. Please bid carefully and only place bids you\'re committed to. We recommend setting a maximum bid amount that you\'re comfortable with.',
      category: 'bidding',
      isOpen: false
    },
    
    // Selling FAQs
    {
      id: 4,
      question: 'How do I create a listing?',
      answer: 'To create a listing, click "Sell Now" in the header, then follow the step-by-step process. You\'ll need to upload photos, write a description, set your starting bid, and choose the auction duration.',
      category: 'selling',
      isOpen: false
    },
    {
      id: 5,
      question: 'What are the seller fees?',
      answer: 'Standard auctions have a 0.5% commission fee, while Private Room auctions have a 2.0% commission fee. Featured listings cost £25 for enhanced visibility. All fees are deducted from the final sale price.',
      category: 'selling',
      isOpen: false
    },
    {
      id: 6,
      question: 'How do I get my items verified?',
      answer: 'During the listing process, you can choose verification levels: Basic (identity check), Advanced (authenticity assessment), or Premium (full authentication with warehouse storage). Premium verification requires sending items to our secure warehouse.',
      category: 'selling',
      isOpen: false
    },

    // Account FAQs
    {
      id: 7,
      question: 'How do I create an account?',
      answer: 'Click "Register" in the top navigation and follow the signup process. You can register using your email address or social media accounts. Account verification is required before bidding.',
      category: 'account',
      isOpen: false
    },
    {
      id: 8,
      question: 'How do I update my profile?',
      answer: 'Go to your account settings by clicking your profile picture in the top right corner. You can update your personal information, notification preferences, and payment methods.',
      category: 'account',
      isOpen: false
    },

    // Payment FAQs
    {
      id: 9,
      question: 'What payment methods do you accept?',
      answer: 'We accept all major credit cards (Visa, Mastercard, American Express) and PayPal. All payments are processed securely through our payment partners.',
      category: 'payments',
      isOpen: false
    },
    {
      id: 10,
      question: 'When will I be charged?',
      answer: 'For auctions, you\'ll be charged immediately upon winning. For sellers, commission fees are deducted from the final sale price before payout. We use secure escrow to protect both buyers and sellers.',
      category: 'payments',
      isOpen: false
    },

    // Verification FAQs
    {
      id: 11,
      question: 'What does "Verified" mean?',
      answer: 'Verified items have been authenticated by our experts and are secured in our warehouse. This gives buyers confidence in the item\'s authenticity and ensures safe delivery.',
      category: 'verification',
      isOpen: false
    },
    {
      id: 12,
      question: 'How long does verification take?',
      answer: 'Basic verification is instant, Advanced verification takes 1-3 business days, and Premium verification takes 3-5 business days after we receive your item.',
      category: 'verification',
      isOpen: false
    },

    // Shipping FAQs
    {
      id: 13,
      question: 'How is shipping handled?',
      answer: 'Shipping costs and arrangements are determined by the seller. Verified items are shipped directly from our secure warehouse. All items are insured during transit.',
      category: 'shipping',
      isOpen: false
    },
    {
      id: 14,
      question: 'What if my item arrives damaged?',
      answer: 'Contact our support team immediately with photos of the damage. We offer buyer protection and will work with you and the seller to resolve the issue, including returns and refunds when appropriate.',
      category: 'shipping',
      isOpen: false
    },

    // Dispute FAQs
    {
      id: 15,
      question: 'How do I file a dispute?',
      answer: 'Go to your order history and click "File Dispute" next to the relevant transaction. Provide details about the issue and any supporting evidence. Our dispute resolution team will investigate and work to resolve the matter fairly.',
      category: 'disputes',
      isOpen: false
    },
    {
      id: 16,
      question: 'How long does dispute resolution take?',
      answer: 'Most disputes are resolved within 5-10 business days. Complex cases may take longer. We keep all parties updated throughout the process.',
      category: 'disputes',
      isOpen: false
    }
  ];

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.filterFAQs();
  }

  selectCategory(categoryId: string): void {
    this.selectedCategory = categoryId;
    this.filterFAQs();
  }

  filterFAQs(): void {
    let filtered = [...this.faqs];

    // Filter by category
    if (this.selectedCategory !== 'all') {
      filtered = filtered.filter(faq => faq.category === this.selectedCategory);
    }

    // Filter by search query
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(faq => 
        faq.question.toLowerCase().includes(query) ||
        faq.answer.toLowerCase().includes(query)
      );
    }

    this.filteredFAQs = filtered;
  }

  toggleFAQ(faq: FAQ): void {
    // Close all other FAQs
    this.faqs.forEach(f => f.isOpen = false);
    // Toggle current FAQ
    faq.isOpen = !faq.isOpen;
  }

  contactSupport(): void {
    this.router.navigate(['/contact']);
  }

  viewHelpCenter(): void {
    // Navigate to help center or open support documentation
    window.open('https://help.bidroom.co', '_blank');
  }
}
