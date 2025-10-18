import { Component } from '@angular/core';
import { Logger } from '@core/services/logger.service';

interface ContactForm {
  name: string;
  email: string;
  subject: string;
  message: string;
  newsletter: boolean;
}

@Component({
  selector: 'app-contact',
  templateUrl: './contact.component.html',
  styleUrls: ['./contact.component.scss']
})
export class ContactComponent {
  contactForm: ContactForm = {
    name: '',
    email: '',
    subject: '',
    message: '',
    newsletter: false
  };

  isSubmitting = false;

  constructor(private logger: Logger) {}

  submitContactForm(): void {
    if (this.isSubmitting) return;

    this.isSubmitting = true;
    
    // Log the form submission
    this.logger.info('Contact form submitted:', this.contactForm);

    // Simulate API call
    setTimeout(() => {
      this.logger.info('Contact form sent successfully');
      
      // Reset form
      this.contactForm = {
        name: '',
        email: '',
        subject: '',
        message: '',
        newsletter: false
      };

      this.isSubmitting = false;
      
      // Show success message (in a real app, you'd use a toast notification)
      alert('Thank you for your message! We\'ll get back to you within 24 hours.');
    }, 2000);
  }
}
