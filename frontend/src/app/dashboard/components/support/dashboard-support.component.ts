import {
  Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef,
  DestroyRef, inject, ViewChild, ElementRef, AfterViewChecked, PLATFORM_ID,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  SupportService,
  SupportConversation,
  SupportMessage,
  OpenConversationPayload,
} from '../../../shared/services/support.service';

const STATUS_LABELS: Record<SupportConversation['status'], string> = {
  open:             'Aberta',
  pending_agent:    'Aguarda resposta',
  pending_customer: 'A aguardar',
  resolved:         'Resolvida',
  closed:           'Fechada',
};

const CATEGORY_LABELS: Record<string, string> = {
  payment:  'Pagamento',
  shipping: 'Envio',
  dispute:  'Disputa',
  account:  'Conta',
  listing:  'Listing',
  other:    'Outro',
};

@Component({
  selector: 'app-dashboard-support',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard-support.component.html',
  styleUrls: ['./dashboard-support.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardSupportComponent implements OnInit, AfterViewChecked {
  private support    = inject(SupportService);
  private cdr        = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  private isBrowser  = isPlatformBrowser(inject(PLATFORM_ID));

  @ViewChild('msgList') private msgListRef?: ElementRef<HTMLElement>;

  conversations: SupportConversation[] = [];
  selected:      SupportConversation | null = null;
  messages:      SupportMessage[] = [];

  loading         = true;
  messagesLoading = false;
  sending         = false;
  draft           = '';

  showNewForm  = false;
  newSubject   = '';
  newCategory  = 'other';
  newMessage   = '';
  creating     = false;

  private needsScroll = false;

  readonly categories = [
    { value: 'payment',  label: 'Pagamento' },
    { value: 'shipping', label: 'Envio' },
    { value: 'dispute',  label: 'Disputa' },
    { value: 'account',  label: 'Conta' },
    { value: 'listing',  label: 'Listing' },
    { value: 'other',    label: 'Outro' },
  ];

  ngOnInit(): void {
    if (!this.isBrowser) return;
    this.loadConversations();

    this.support.onSupportMessage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ conversationId, message }) => {
        const idx = this.conversations.findIndex(c => c._id === conversationId);
        if (idx >= 0) {
          const prev = this.conversations[idx];
          const updated: SupportConversation = {
            ...prev,
            lastMessageAt: message.createdAt,
            lastMessageBy: message.senderType,
            unreadByCustomer: message.senderType === 'agent'
              ? prev.unreadByCustomer + 1
              : prev.unreadByCustomer,
          };
          this.conversations = [updated, ...this.conversations.filter((_, i) => i !== idx)];
        }
        if (this.selected?._id === conversationId) {
          this.messages    = [...this.messages, message];
          this.needsScroll = true;
        }
        this.cdr.markForCheck();
      });

    this.support.onConversationUpdated()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ conversationId, status }) => {
        const idx = this.conversations.findIndex(c => c._id === conversationId);
        if (idx >= 0) {
          this.conversations[idx] = {
            ...this.conversations[idx],
            status: status as SupportConversation['status'],
          };
          this.conversations = [...this.conversations];
        }
        if (this.selected?._id === conversationId) {
          this.selected = { ...this.selected, status: status as SupportConversation['status'] };
        }
        this.cdr.markForCheck();
      });
  }

  ngAfterViewChecked(): void {
    if (this.needsScroll) {
      const el = this.msgListRef?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
      this.needsScroll = false;
    }
  }

  loadConversations(): void {
    this.loading = true;
    this.support.getMyConversations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ conversations }) => {
          this.conversations = conversations;
          this.loading = false;
          if (conversations.length > 0 && !this.selected) {
            this.selectConversation(conversations[0]);
          }
          this.cdr.markForCheck();
        },
        error: () => { this.loading = false; this.cdr.markForCheck(); },
      });
  }

  selectConversation(conv: SupportConversation): void {
    this.selected       = conv;
    this.messages       = [];
    this.draft          = '';
    this.showNewForm    = false;
    this.messagesLoading = true;
    this.support.getMessages(conv._id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ messages }) => {
          this.messages        = messages;
          this.messagesLoading = false;
          this.needsScroll     = true;
          const idx = this.conversations.findIndex(c => c._id === conv._id);
          if (idx >= 0) {
            this.conversations[idx] = { ...this.conversations[idx], unreadByCustomer: 0 };
            this.conversations = [...this.conversations];
          }
          this.cdr.markForCheck();
        },
        error: () => { this.messagesLoading = false; this.cdr.markForCheck(); },
      });
  }

  send(): void {
    const body = this.draft.trim();
    if (!body || !this.selected || this.sending) return;
    this.sending = true;
    this.support.sendMessage(this.selected._id, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ message }) => {
          this.messages    = [...this.messages, message];
          this.draft       = '';
          this.sending     = false;
          this.needsScroll = true;
          this.cdr.markForCheck();
        },
        error: () => { this.sending = false; this.cdr.markForCheck(); },
      });
  }

  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.send();
    }
  }

  openNewForm(): void {
    this.showNewForm = true;
    this.selected    = null;
    this.messages    = [];
    this.newSubject  = '';
    this.newCategory = 'other';
    this.newMessage  = '';
  }

  cancelNew(): void {
    this.showNewForm = false;
    if (this.conversations.length > 0) this.selectConversation(this.conversations[0]);
  }

  submitNew(): void {
    const body = this.newMessage.trim();
    if (!body || this.creating) return;
    this.creating = true;
    const payload: OpenConversationPayload = {
      category:       this.newCategory,
      subject:        this.newSubject.trim() || undefined,
      initialMessage: body,
    };
    this.support.openConversation(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ conversation }) => {
          this.conversations  = [conversation, ...this.conversations];
          this.showNewForm    = false;
          this.creating       = false;
          this.selectConversation(conversation);
          this.cdr.markForCheck();
        },
        error: () => { this.creating = false; this.cdr.markForCheck(); },
      });
  }

  statusLabel(s: string): string { return STATUS_LABELS[s as SupportConversation['status']] ?? s; }
  categoryLabel(c: string): string { return CATEGORY_LABELS[c] ?? c; }

  statusClass(s: string): string {
    const map: Record<string, string> = {
      open:             'chip--open',
      pending_agent:    'chip--warn',
      pending_customer: 'chip--info',
      resolved:         'chip--ok',
      closed:           'chip--muted',
    };
    return map[s] ?? '';
  }

  isActive(conv: SupportConversation): boolean { return this.selected?._id === conv._id; }
  canReply(): boolean { return !!this.selected && this.selected.status !== 'closed' && this.selected.status !== 'resolved'; }

  trackByConv(_: number, c: SupportConversation): string { return c._id; }
  trackByMsg (_: number, m: SupportMessage): string { return m._id; }
}
