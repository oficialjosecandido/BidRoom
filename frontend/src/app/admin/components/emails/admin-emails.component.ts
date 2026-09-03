import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AdminEmailsService,
  EmailAudience,
  CampaignLanguage,
  CampaignContent,
  InterestedContact,
  SendResult,
  DraftReminderRow,
  CustomerSearchResult
} from '../../services/admin-emails.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';

@Component({
  selector: 'app-admin-emails',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminSidebarComponent],
  templateUrl: './admin-emails.component.html',
  styleUrls: ['./admin-emails.component.scss']
})
export class AdminEmailsComponent implements OnInit {
  private adminEmailsService = inject(AdminEmailsService);
  private destroyRef = inject(DestroyRef);

  activeTab: 'newsletter' | 'personalized' | 'preferences' = 'newsletter';

  // ---- Newsletter ----
  readonly LANGUAGES: { code: CampaignLanguage; label: string }[] = [
    { code: 'pt', label: 'Português' },
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' }
  ];

  audience: EmailAudience = 'all_users';
  audienceCount: number | null = null;
  loadingCount = false;

  activeLanguage: CampaignLanguage = 'pt';
  content: CampaignContent = {
    pt: { subject: '', html: '' },
    en: { subject: '', html: '' },
    fr: { subject: '', html: '' },
    es: { subject: '', html: '' }
  };

  sendingTest = false;
  testMessage: string | null = null;
  testError: string | null = null;

  sendingCampaign = false;
  campaignResult: SendResult | null = null;
  campaignError: string | null = null;

  // Interested contacts
  interestedContacts: InterestedContact[] = [];
  loadingInterested = true;
  newContactEmail = '';
  newContactName = '';
  newContactLanguage: CampaignLanguage = 'pt';
  addingContact = false;
  addContactError: string | null = null;

  // ---- Personalized ----
  personalizedSection: 'drafts' | 'customer' = 'drafts';

  draftReminders: DraftReminderRow[] = [];
  loadingDrafts = true;
  draftsError: string | null = null;
  editingDraft: DraftReminderRow | null = null;
  draftSubject = '';
  draftHtml = '';
  sendingDraft = false;
  draftSendError: string | null = null;

  private customerSearch$ = new Subject<string>();
  customerQuery = '';
  customerResults: CustomerSearchResult[] = [];
  searchingCustomers = false;
  selectedCustomer: CustomerSearchResult | null = null;
  customerSubject = '';
  customerHtml = '';
  sendingCustomerEmail = false;
  customerSendError: string | null = null;
  customerSendMessage: string | null = null;

  // ---- Preferences: customer lookup ----
  private prefsCustomerSearch$ = new Subject<string>();
  prefsCustomerQuery = '';
  prefsCustomerResults: CustomerSearchResult[] = [];
  prefsSearchingCustomers = false;
  prefsSelectedCustomer: CustomerSearchResult | null = null;
  prefsSaving = false;
  prefsSaveError: string | null = null;

  ngOnInit(): void {
    this.loadAudienceCount();
    this.loadInterested();
    this.loadDraftReminders();

    this.customerSearch$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => q.trim().length >= 2
        ? this.adminEmailsService.searchCustomers(q.trim())
        : of({ customers: [] as CustomerSearchResult[] })),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (res) => { this.customerResults = res.customers; this.searchingCustomers = false; },
      error: () => { this.searchingCustomers = false; }
    });

    this.prefsCustomerSearch$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => q.trim().length >= 2
        ? this.adminEmailsService.searchCustomers(q.trim())
        : of({ customers: [] as CustomerSearchResult[] })),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (res) => { this.prefsCustomerResults = res.customers; this.prefsSearchingCustomers = false; },
      error: () => { this.prefsSearchingCustomers = false; }
    });
  }

  setTab(tab: 'newsletter' | 'personalized' | 'preferences'): void {
    this.activeTab = tab;
  }

  setPersonalizedSection(section: 'drafts' | 'customer'): void {
    this.personalizedSection = section;
  }

  // ---- Newsletter ----

  setAudience(audience: EmailAudience): void {
    this.audience = audience;
    this.loadAudienceCount();
  }

  setActiveLanguage(lang: CampaignLanguage): void {
    this.activeLanguage = lang;
  }

  loadAudienceCount(): void {
    this.loadingCount = true;
    this.adminEmailsService.getAudienceCount(this.audience).subscribe({
      next: (res) => { this.audienceCount = res.count; this.loadingCount = false; },
      error: () => { this.audienceCount = null; this.loadingCount = false; }
    });
  }

  get canSendTest(): boolean {
    const variant = this.content[this.activeLanguage];
    return variant.subject.trim().length > 0 && variant.html.trim().length > 0;
  }

  get canSendCampaign(): boolean {
    return this.LANGUAGES.every(l => {
      const variant = this.content[l.code];
      return variant.subject.trim().length > 0 && variant.html.trim().length > 0;
    });
  }

  sendTest(): void {
    if (!this.canSendTest || this.sendingTest) return;
    const variant = this.content[this.activeLanguage];
    this.sendingTest = true;
    this.testMessage = null;
    this.testError = null;
    this.adminEmailsService.sendTest(variant.subject.trim(), variant.html, this.activeLanguage).subscribe({
      next: (res) => {
        this.sendingTest = false;
        this.testMessage = `Email de teste (${this.activeLanguage.toUpperCase()}) enviado para ${res.to}.`;
      },
      error: (err) => {
        this.sendingTest = false;
        this.testError = err?.error?.error || 'Falha ao enviar email de teste.';
      }
    });
  }

  sendCampaign(): void {
    if (!this.canSendCampaign || this.sendingCampaign) return;
    const count = this.audienceCount ?? 0;
    const audienceLabel = this.audience === 'all_users' ? 'todos os utilizadores' : 'todos os interessados';
    const confirmed = window.confirm(
      `Enviar esta campanha para ${count} destinatário(s) (${audienceLabel})? Cada destinatário recebe a versão no seu idioma. Esta ação não pode ser desfeita.`
    );
    if (!confirmed) return;

    this.sendingCampaign = true;
    this.campaignResult = null;
    this.campaignError = null;
    this.adminEmailsService.sendCampaign(this.content, this.audience).subscribe({
      next: (res) => {
        this.sendingCampaign = false;
        this.campaignResult = res;
      },
      error: (err) => {
        this.sendingCampaign = false;
        this.campaignError = err?.error?.error || 'Falha ao enviar campanha.';
      }
    });
  }

  // ---- Interested contacts ----

  loadInterested(): void {
    this.loadingInterested = true;
    this.adminEmailsService.getInterestedContacts().subscribe({
      next: (res) => { this.interestedContacts = res.contacts; this.loadingInterested = false; },
      error: () => { this.loadingInterested = false; }
    });
  }

  addContact(): void {
    const email = this.newContactEmail.trim();
    if (!email || this.addingContact) return;
    this.addingContact = true;
    this.addContactError = null;
    this.adminEmailsService.addInterestedContact(email, this.newContactName.trim() || undefined, this.newContactLanguage).subscribe({
      next: (res) => {
        this.addingContact = false;
        this.interestedContacts = [res.contact, ...this.interestedContacts];
        this.newContactEmail = '';
        this.newContactName = '';
        this.newContactLanguage = 'pt';
        if (this.audience === 'interested') this.loadAudienceCount();
      },
      error: (err) => {
        this.addingContact = false;
        this.addContactError = err?.error?.error || 'Falha ao adicionar contacto.';
      }
    });
  }

  updateContactLanguage(contact: InterestedContact, language: CampaignLanguage): void {
    const previous = contact.language;
    contact.language = language;
    this.adminEmailsService.updateInterestedContact(contact._id, { language }).subscribe({
      error: () => { contact.language = previous; }
    });
  }

  toggleContactUnsubscribed(contact: InterestedContact): void {
    const previous = contact.unsubscribed;
    contact.unsubscribed = !previous;
    this.adminEmailsService.updateInterestedContact(contact._id, { unsubscribed: contact.unsubscribed }).subscribe({
      error: () => { contact.unsubscribed = previous; }
    });
  }

  removeContact(contact: InterestedContact): void {
    if (!window.confirm(`Remover ${contact.email} da lista de interessados?`)) return;
    this.adminEmailsService.removeInterestedContact(contact._id).subscribe({
      next: () => {
        this.interestedContacts = this.interestedContacts.filter(c => c._id !== contact._id);
        if (this.audience === 'interested') this.loadAudienceCount();
      },
      error: () => {}
    });
  }

  // ---- Personalized: draft reminders ----

  loadDraftReminders(): void {
    this.loadingDrafts = true;
    this.draftsError = null;
    this.adminEmailsService.getDraftReminders().subscribe({
      next: (res) => { this.draftReminders = res.drafts; this.loadingDrafts = false; },
      error: (err) => {
        this.draftsError = err?.error?.error || 'Falha ao carregar rascunhos.';
        this.loadingDrafts = false;
      }
    });
  }

  openDraftEditor(row: DraftReminderRow): void {
    this.editingDraft = row;
    this.draftSubject = row.previewSubject;
    this.draftHtml = row.previewHtml;
    this.draftSendError = null;
  }

  closeDraftEditor(): void {
    this.editingDraft = null;
  }

  sendDraftReminderEmail(): void {
    if (!this.editingDraft || this.sendingDraft) return;
    if (!this.draftSubject.trim() || !this.draftHtml.trim()) {
      this.draftSendError = 'Assunto e HTML são obrigatórios.';
      return;
    }
    this.sendingDraft = true;
    this.draftSendError = null;
    const draftId = this.editingDraft._id;
    this.adminEmailsService.sendDraftReminder(draftId, this.draftSubject.trim(), this.draftHtml).subscribe({
      next: () => {
        this.sendingDraft = false;
        const idx = this.draftReminders.findIndex(d => d._id === draftId);
        if (idx !== -1) this.draftReminders[idx] = { ...this.draftReminders[idx], draftReminderSent: true };
        this.closeDraftEditor();
      },
      error: (err) => {
        this.sendingDraft = false;
        this.draftSendError = err?.error?.error || 'Falha ao enviar lembrete.';
      }
    });
  }

  // ---- Personalized: any customer ----

  onCustomerQueryChange(value: string): void {
    this.customerQuery = value;
    this.searchingCustomers = value.trim().length >= 2;
    this.customerSearch$.next(value);
  }

  selectCustomer(customer: CustomerSearchResult): void {
    this.selectedCustomer = customer;
    this.customerSubject = '';
    this.customerHtml = '';
    this.customerSendError = null;
    this.customerSendMessage = null;
    this.customerResults = [];
    this.customerQuery = '';
  }

  clearSelectedCustomer(): void {
    this.selectedCustomer = null;
  }

  sendCustomerEmail(): void {
    if (!this.selectedCustomer || this.sendingCustomerEmail) return;
    if (!this.customerSubject.trim() || !this.customerHtml.trim()) {
      this.customerSendError = 'Assunto e HTML são obrigatórios.';
      return;
    }
    this.sendingCustomerEmail = true;
    this.customerSendError = null;
    this.customerSendMessage = null;
    this.adminEmailsService.sendToCustomer(this.selectedCustomer._id, this.customerSubject.trim(), this.customerHtml).subscribe({
      next: (res) => {
        this.sendingCustomerEmail = false;
        this.customerSendMessage = `Email enviado para ${res.sentTo}.`;
      },
      error: (err) => {
        this.sendingCustomerEmail = false;
        this.customerSendError = err?.error?.error || 'Falha ao enviar email.';
      }
    });
  }

  // ---- Preferences: customer lookup ----

  onPrefsCustomerQueryChange(value: string): void {
    this.prefsCustomerQuery = value;
    this.prefsSearchingCustomers = value.trim().length >= 2;
    this.prefsCustomerSearch$.next(value);
  }

  selectPrefsCustomer(customer: CustomerSearchResult): void {
    this.prefsSelectedCustomer = customer;
    this.prefsSaveError = null;
    this.prefsCustomerResults = [];
    this.prefsCustomerQuery = '';
  }

  clearPrefsCustomer(): void {
    this.prefsSelectedCustomer = null;
  }

  savePrefsCustomerLanguage(language: CampaignLanguage): void {
    if (!this.prefsSelectedCustomer || this.prefsSaving) return;
    const previous = this.prefsSelectedCustomer.language;
    this.prefsSelectedCustomer.language = language;
    this.prefsSaving = true;
    this.prefsSaveError = null;
    this.adminEmailsService.updateCustomerPreferences(this.prefsSelectedCustomer._id, { language }).subscribe({
      next: () => { this.prefsSaving = false; },
      error: (err) => {
        this.prefsSaving = false;
        if (this.prefsSelectedCustomer) this.prefsSelectedCustomer.language = previous;
        this.prefsSaveError = err?.error?.error || 'Falha ao guardar idioma.';
      }
    });
  }

  togglePrefsCustomerUnsubscribed(): void {
    if (!this.prefsSelectedCustomer || this.prefsSaving) return;
    const previous = this.prefsSelectedCustomer.unsubscribed;
    const unsubscribed = !previous;
    this.prefsSelectedCustomer.unsubscribed = unsubscribed;
    this.prefsSaving = true;
    this.prefsSaveError = null;
    this.adminEmailsService.updateCustomerPreferences(this.prefsSelectedCustomer._id, { unsubscribed }).subscribe({
      next: () => { this.prefsSaving = false; },
      error: (err) => {
        this.prefsSaving = false;
        if (this.prefsSelectedCustomer) this.prefsSelectedCustomer.unsubscribed = previous;
        this.prefsSaveError = err?.error?.error || 'Falha ao guardar preferência.';
      }
    });
  }

  formatDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' });
  }
}
