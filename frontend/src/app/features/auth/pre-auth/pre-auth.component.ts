import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, PreAuthRequest, PreAuthResponse } from '@core/services/auth.service';
import { Logger } from '@core/services/logger.service';

declare var Stripe: any;

@Component({
  selector: 'app-pre-auth',
  templateUrl: './pre-auth.component.html',
  styleUrls: ['./pre-auth.component.scss']
})
export class PreAuthComponent implements OnInit {
  preAuthForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';
  stripe: any;
  elements: any;
  cardElement: any;
  preAuthId: string | null = null;
  clientSecret: string | null = null;

  // Tier information
  tiers = [
    {
      id: 'basic',
      name: 'Basic',
      description: 'Email verification only',
      amount: 0,
      features: ['Browse auctions', 'Basic bidding']
    },
    {
      id: 'verified',
      name: 'Verified',
      description: 'Credit card verification required',
      amount: 1,
      features: ['All Basic features', 'Bid on any auction', 'Create listings']
    },
    {
      id: 'premium',
      name: 'Premium',
      description: 'Enhanced verification for high-value auctions',
      amount: 100,
      features: ['All Verified features', 'High-value bidding', 'Priority support']
    }
  ];

  selectedTier = this.tiers[1]; // Default to verified

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private logger: Logger
  ) {
    this.preAuthForm = this.fb.group({
      tier: ['verified', Validators.required],
      amount: [1, Validators.required]
    });
  }

  async ngOnInit(): Promise<void> {
    // Initialize Stripe
    this.stripe = Stripe('pk_test_your_stripe_publishable_key'); // Replace with actual key
    
    // Update form when tier changes
    this.preAuthForm.get('tier')?.valueChanges.subscribe(tierId => {
      const tier = this.tiers.find(t => t.id === tierId);
      if (tier) {
        this.selectedTier = tier;
        this.preAuthForm.patchValue({ amount: tier.amount });
      }
    });
  }

  selectTier(tierId: string): void {
    const tier = this.tiers.find(t => t.id === tierId);
    if (tier) {
      this.selectedTier = tier;
      this.preAuthForm.patchValue({ 
        tier: tierId,
        amount: tier.amount 
      });
    }
  }

  async initializeStripe(): Promise<void> {
    if (!this.clientSecret) return;

    this.elements = this.stripe.elements({ clientSecret: this.clientSecret });
    this.cardElement = this.elements.create('card', {
      style: {
        base: {
          fontSize: '16px',
          color: '#424770',
          '::placeholder': {
            color: '#aab7c4',
          },
        },
      },
    });

    this.cardElement.mount('#card-element');

    this.cardElement.on('change', (event: any) => {
      if (event.error) {
        this.errorMessage = event.error.message;
      } else {
        this.errorMessage = '';
      }
    });
  }

  async createPreAuthorization(): Promise<void> {
    if (this.preAuthForm.invalid) return;

    this.isLoading = true;
    this.errorMessage = '';

    const request: PreAuthRequest = {
      amount: this.selectedTier.amount,
      currency: 'usd',
      auctionId: undefined // General pre-auth, not for specific auction
    };

    try {
      const response = await this.authService.createPreAuthorization(request).toPromise();
      
      if (response) {
        this.preAuthId = response.preAuthId;
        this.clientSecret = response.clientSecret;
        
        // Initialize Stripe with the client secret
        await this.initializeStripe();
        this.successMessage = 'Payment form loaded. Please enter your card details.';
      }
    } catch (error) {
      this.logger.error('Failed to create pre-authorization:', error);
      this.errorMessage = 'Failed to initialize payment. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  async confirmPayment(): Promise<void> {
    if (!this.stripe || !this.cardElement || !this.clientSecret) return;

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const { error, paymentIntent } = await this.stripe.confirmCardPayment(this.clientSecret, {
        payment_method: {
          card: this.cardElement,
        }
      });

      if (error) {
        this.errorMessage = error.message;
      } else if (paymentIntent.status === 'succeeded') {
        // Confirm the pre-authorization with our backend
        if (this.preAuthId) {
          await this.authService.confirmPreAuthorization(
            this.preAuthId, 
            paymentIntent.payment_method
          ).toPromise();
        }

        this.successMessage = 'Payment verified successfully! You can now bid on auctions.';
        
        // Redirect to dashboard after a short delay
        setTimeout(() => {
          this.router.navigate(['/dashboard']);
        }, 2000);
      }
    } catch (error) {
      this.logger.error('Payment confirmation failed:', error);
      this.errorMessage = 'Payment failed. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  skipVerification(): void {
    // For basic tier, just redirect to dashboard
    this.router.navigate(['/dashboard']);
  }

  get tier() {
    return this.preAuthForm.get('tier');
  }

  get amount() {
    return this.preAuthForm.get('amount');
  }
}
