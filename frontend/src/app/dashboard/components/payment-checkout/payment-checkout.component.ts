import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { PaymentService, FeeBreakdown } from '../../../shared/services/payment.service';
import { Stripe, StripeElements } from '@stripe/stripe-js';

@Component({
  selector: 'app-payment-checkout',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './payment-checkout.component.html',
  styleUrls: ['./payment-checkout.component.scss']
})
export class PaymentCheckoutComponent implements OnInit, OnDestroy {
  listingId: string | null = null;
  transactionId: string | null = null;
  fees: FeeBreakdown | null = null;
  isLoading = true;
  isProcessing = false;
  error: string | null = null;
  paymentSuccess = false;

  private stripe: Stripe | null = null;
  private elements: StripeElements | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private paymentService: PaymentService
  ) {}

  ngOnInit(): void {
    this.listingId = this.route.snapshot.queryParamMap.get('listing');
    if (this.listingId) {
      this.initPayment();
    } else {
      this.error = 'No listing specified for payment.';
      this.isLoading = false;
    }
  }

  ngOnDestroy(): void {
    // Clean up Stripe elements if mounted
  }

  async initPayment(): Promise<void> {
    try {
      this.isLoading = true;

      // Create payment intent on server
      const response = await this.paymentService
        .createPaymentIntent(this.listingId!)
        .toPromise();

      if (!response) {
        this.error = 'Failed to initialize payment.';
        this.isLoading = false;
        return;
      }

      this.fees = response.fees;
      this.transactionId = response.transactionId;

      // Load Stripe
      this.stripe = await this.paymentService.getStripe(response.stripePublicKey);
      if (!this.stripe) {
        this.error = 'Failed to load payment processor.';
        this.isLoading = false;
        return;
      }

      // Mount Stripe Payment Element
      this.elements = this.stripe.elements({
        clientSecret: response.clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#1a1a2e',
            colorBackground: '#ffffff',
            colorText: '#1a1a2e',
            fontFamily: 'system-ui, sans-serif',
            borderRadius: '8px'
          }
        }
      });

      const paymentElement = this.elements.create('payment');

      // Wait for DOM then mount
      setTimeout(() => {
        const container = document.getElementById('stripe-payment-element');
        if (container) {
          paymentElement.mount('#stripe-payment-element');
        }
        this.isLoading = false;
      }, 100);

    } catch (err: any) {
      this.error = err?.error?.error || 'Failed to initialize payment. Please try again.';
      this.isLoading = false;
    }
  }

  async submitPayment(): Promise<void> {
    if (!this.stripe || !this.elements || this.isProcessing) return;

    this.isProcessing = true;
    this.error = null;

    const { error } = await this.stripe.confirmPayment({
      elements: this.elements,
      confirmParams: {
        return_url: `${window.location.origin}/dashboard/transactions`
      },
      redirect: 'if_required'
    });

    if (error) {
      this.error = error.message || 'Payment failed. Please try again.';
      this.isProcessing = false;
    } else {
      this.paymentSuccess = true;
      this.isProcessing = false;
      // Navigate to invoice after short delay
      setTimeout(() => {
        this.router.navigate(['/dashboard/invoice', this.transactionId]);
      }, 2000);
    }
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  }
}
