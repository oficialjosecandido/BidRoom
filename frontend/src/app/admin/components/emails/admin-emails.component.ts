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
  UnifiedContact,
  SendResult,
  DraftReminderRow,
  CustomerSearchResult,
  EmailCampaignRow,
  CampaignDelivery
} from '../../services/admin-emails.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';

type EmailsTab = 'newsletter' | 'personalized' | 'history' | 'preferences';

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

  activeTab: EmailsTab = 'newsletter';

  // ---- Newsletter ----
  readonly LANGUAGES: { code: CampaignLanguage; label: string }[] = [
    { code: 'pt', label: 'Português' },
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' }
  ];

  audience: EmailAudience = 'all_contacts';
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

  // Unified contacts
  contacts: UnifiedContact[] = [];
  loadingContacts = true;
  contactsFilter: 'all' | 'customers' | 'interested' = 'all';
  contactsQuery = '';
  newContactEmail = '';
  newContactName = '';
  newContactLanguage: CampaignLanguage = 'pt';
  addingContact = false;
  addContactError: string | null = null;

  // ---- Sent history ----
  campaigns: EmailCampaignRow[] = [];
  loadingCampaigns = false;
  campaignsError: string | null = null;
  expandedCampaignId: string | null = null;
  deliveriesByCampaign: Record<string, CampaignDelivery[]> = {};
  loadingDeliveriesFor: string | null = null;

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

  ngOnInit(): void {
    this.loadAudienceCount();
    this.loadContacts();
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
  }

  setTab(tab: EmailsTab): void {
    this.activeTab = tab;
    // Loaded on demand: opens keep arriving after a send, so the list is only
    // worth fetching when it is about to be looked at.
    if (tab === 'history' && this.campaigns.length === 0) this.loadCampaigns();
  }

  // ---- Sent history ----

  loadCampaigns(): void {
    this.loadingCampaigns = true;
    this.campaignsError = null;
    this.adminEmailsService.getCampaigns().subscribe({
      next: (res) => { this.campaigns = res.campaigns; this.loadingCampaigns = false; },
      error: (err) => {
        this.loadingCampaigns = false;
        this.campaignsError = err?.error?.error || 'Falha ao carregar o histórico.';
      }
    });
  }

  campaignKindLabel(row: EmailCampaignRow): string {
    if (row.kind === 'newsletter') return `Newsletter · ${this.audienceLabel(row.audience ?? 'all_contacts')}`;
    if (row.kind === 'draft-reminder') return 'Lembrete de rascunho';
    return 'Email personalizado';
  }

  toggleCampaignDetails(row: EmailCampaignRow): void {
    if (this.expandedCampaignId === row._id) {
      this.expandedCampaignId = null;
      return;
    }
    this.expandedCampaignId = row._id;
    if (this.deliveriesByCampaign[row._id]) return;

    this.loadingDeliveriesFor = row._id;
    this.adminEmailsService.getCampaignDeliveries(row._id).subscribe({
      next: (res) => {
        this.deliveriesByCampaign[row._id] = res.deliveries;
        this.loadingDeliveriesFor = null;
      },
      error: () => { this.loadingDeliveriesFor = null; }
    });
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

  private audienceLabel(audience: EmailAudience): string {
    if (audience === 'all_contacts') return 'todos os contactos';
    if (audience === 'all_users') return 'só clientes';
    return 'só interessados';
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
    const confirmed = window.confirm(
      `Enviar esta campanha para ${count} destinatário(s) (${this.audienceLabel(this.audience)})? Cada destinatário recebe a versão no seu idioma. Esta ação não pode ser desfeita.`
    );
    if (!confirmed) return;

    this.sendingCampaign = true;
    this.campaignResult = null;
    this.campaignError = null;
    this.adminEmailsService.sendCampaign(this.content, this.audience).subscribe({
      next: (res) => {
        this.sendingCampaign = false;
        this.campaignResult = res;
        // The send just added a row and bumped every recipient's counter.
        this.loadCampaigns();
        this.loadContacts();
      },
      error: (err) => {
        this.sendingCampaign = false;
        this.campaignError = err?.error?.error || 'Falha ao enviar campanha.';
      }
    });
  }

  // ---- Unified contacts ----

  loadContacts(): void {
    this.loadingContacts = true;
    this.adminEmailsService.getContacts().subscribe({
      next: (res) => { this.contacts = res.contacts; this.loadingContacts = false; },
      error: () => { this.loadingContacts = false; }
    });
  }

  get filteredContacts(): UnifiedContact[] {
    const q = this.contactsQuery.trim().toLowerCase();
    return this.contacts.filter(c => {
      if (this.contactsFilter === 'customers' && !c.isCustomer) return false;
      if (this.contactsFilter === 'interested' && c.isCustomer) return false;
      if (!q) return true;
      return (
        String(c.email || '').toLowerCase().includes(q) ||
        String(c.name || '').toLowerCase().includes(q)
      );
    });
  }

  get contactsSummary(): string {
    const customers = this.contacts.filter(c => c.isCustomer).length;
    const interested = this.contacts.filter(c => !c.isCustomer).length;
    return `${this.contacts.length} contactos · ${customers} clientes · ${interested} interessados`;
  }

  addContact(): void {
    const email = this.newContactEmail.trim();
    if (!email || this.addingContact) return;
    this.addingContact = true;
    this.addContactError = null;
    this.adminEmailsService.addInterestedContact(email, this.newContactName.trim() || undefined, this.newContactLanguage).subscribe({
      next: (res) => {
        this.addingContact = false;
        this.contacts = [res.contact, ...this.contacts];
        this.newContactEmail = '';
        this.newContactName = '';
        this.newContactLanguage = 'pt';
        this.loadAudienceCount();
      },
      error: (err) => {
        this.addingContact = false;
        this.addContactError = err?.error?.error || 'Falha ao adicionar contacto.';
      }
    });
  }

  updateContactLanguage(contact: UnifiedContact, language: CampaignLanguage): void {
    const previous = contact.language;
    contact.language = language;
    this.adminEmailsService.updateContact(contact.type, contact._id, { language }).subscribe({
      error: () => { contact.language = previous; }
    });
  }

  toggleContactUnsubscribed(contact: UnifiedContact): void {
    const previous = contact.unsubscribed;
    contact.unsubscribed = !previous;
    this.adminEmailsService.updateContact(contact.type, contact._id, { unsubscribed: contact.unsubscribed }).subscribe({
      next: () => this.loadAudienceCount(),
      error: () => { contact.unsubscribed = previous; }
    });
  }

  removeContact(contact: UnifiedContact): void {
    if (contact.isCustomer) return;
    if (!window.confirm(`Remover ${contact.email} da lista de contactos?`)) return;
    this.adminEmailsService.removeInterestedContact(contact._id).subscribe({
      next: () => {
        this.contacts = this.contacts.filter(c => !(c._id === contact._id && c.type === 'interested'));
        this.loadAudienceCount();
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

  formatDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' });
  }
}
