import {
  Component, OnInit, OnDestroy, ChangeDetectionStrategy,
  ChangeDetectorRef, DestroyRef, inject, ViewChild, ElementRef, AfterViewChecked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';
import { AuthService } from '../../../auth/services/auth.service';
import {
  SupportService,
  SupportConversation,
  SupportMessage,
} from '../../../shared/services/support.service';

const STATUS_LABELS: Record<SupportConversation['status'], string> = {
  open:             'Aberta',
  pending_agent:    'Aguarda resposta',
  pending_customer: 'Aguarda cliente',
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
  selector: 'app-admin-support',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminSidebarComponent],
  templateUrl: './admin-support.component.html',
  styleUrls: ['./admin-support.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminSupportComponent implements OnInit, OnDestroy, AfterViewChecked {
  private destroyRef = inject(DestroyRef);
  private support    = inject(SupportService);
  private auth       = inject(AuthService);
  private cdr        = inject(ChangeDetectorRef);

  @ViewChild('threadBody') private threadRef?: ElementRef<HTMLElement>;

  conversations: SupportConversation[] = [];
  selected:      SupportConversation | null = null;
  messages:      SupportMessage[] = [];

  loading        = true;
  messagesLoading = false;
  sending        = false;
  replyDraft     = '';
  statusFilter   = 'pending_agent';

  currentAgentEmail: string | null = null;

  private needsScroll = false;

  readonly statusOptions: { value: string; label: string }[] = [
    { value: '',               label: 'Todas' },
    { value: 'pending_agent',  label: 'Aguarda resposta' },
    { value: 'open',           label: 'Abertas' },
    { value: 'pending_customer', label: 'Aguarda cliente' },
    { value: 'resolved',       label: 'Resolvidas' },
    { value: 'closed',         label: 'Fechadas' },
  ];

  ngOnInit(): void {
    this.auth.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(user => { this.currentAgentEmail = user?.email ?? null; });

    this.support.joinSupportAgents();
    this.loadQueue();

    this.support.onSupportMessage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ conversationId, message }) => {
        // Update the conversation list entry
        const idx = this.conversations.findIndex(c => c._id === conversationId);
        if (idx >= 0) {
          const prev = this.conversations[idx];
          this.conversations = [
            {
              ...prev,
              lastMessageAt: message.createdAt as string,
              lastMessageBy: message.senderType as 'customer' | 'agent' | 'system',
              unreadByAgent: message.senderType === 'customer' ? prev.unreadByAgent + 1 : prev.unreadByAgent,
            },
            ...this.conversations.filter((_, i) => i !== idx),
          ];
        } else {
          this.loadQueue(); // new conversation arrived — refresh list
        }

        if (this.selected?._id === conversationId) {
          this.messages    = [...this.messages, message as unknown as SupportMessage];
          this.needsScroll = true;
        }
        this.cdr.markForCheck();
      });

    this.support.onConversationUpdated()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ conversationId, status }) => {
        const idx = this.conversations.findIndex(c => c._id === conversationId);
        if (idx >= 0) {
          this.conversations[idx] = { ...this.conversations[idx], status: status as SupportConversation['status'] };
          this.conversations = [...this.conversations];
        }
        if (this.selected?._id === conversationId) {
          this.selected = { ...this.selected, status: status as SupportConversation['status'] };
        }
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.support.leaveSupportAgents();
  }

  ngAfterViewChecked(): void {
    if (this.needsScroll) {
      const el = this.threadRef?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
      this.needsScroll = false;
    }
  }

  loadQueue(): void {
    this.loading = true;
    const params = this.statusFilter ? { status: this.statusFilter } : {};
    this.support.getAdminConversations(params)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ conversations }) => {
          this.conversations = conversations;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => { this.loading = false; this.cdr.markForCheck(); },
      });
  }

  setStatusFilter(value: string): void {
    this.statusFilter = value;
    this.loadQueue();
  }

  selectConversation(conv: SupportConversation): void {
    this.selected    = conv;
    this.messages    = [];
    this.replyDraft  = '';
    this.messagesLoading = true;
    this.support.getMessages(conv._id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ messages }) => {
          this.messages = messages;
          this.messagesLoading = false;
          this.needsScroll = true;
          // Reset unread in the list
          const idx = this.conversations.findIndex(c => c._id === conv._id);
          if (idx >= 0) {
            this.conversations[idx] = { ...this.conversations[idx], unreadByAgent: 0 };
            this.conversations = [...this.conversations];
          }
          this.cdr.markForCheck();
        },
        error: () => { this.messagesLoading = false; this.cdr.markForCheck(); },
      });
  }

  sendReply(): void {
    const body = this.replyDraft.trim();
    if (!body || !this.selected || this.sending) return;
    this.sending = true;
    this.support.sendMessage(this.selected._id, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ message }) => {
          this.messages    = [...this.messages, message];
          this.replyDraft  = '';
          this.sending     = false;
          this.needsScroll = true;
          this.cdr.markForCheck();
        },
        error: () => { this.sending = false; this.cdr.markForCheck(); },
      });
  }

  setConvStatus(status: SupportConversation['status']): void {
    if (!this.selected) return;
    this.support.updateAdminConversation(this.selected._id, { status })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ conversation }) => {
          this.selected = conversation;
          const idx = this.conversations.findIndex(c => c._id === conversation._id);
          if (idx >= 0) this.conversations[idx] = conversation;
          this.conversations = [...this.conversations];
          this.cdr.markForCheck();
        },
      });
  }

  assignToMe(): void {
    if (!this.selected || !this.currentAgentEmail) return;
    this.support.updateAdminConversation(this.selected._id, { assignedAgent: this.currentAgentEmail })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ conversation }) => {
          this.selected = conversation;
          this.cdr.markForCheck();
        },
      });
  }

  unassign(): void {
    if (!this.selected) return;
    this.support.updateAdminConversation(this.selected._id, { assignedAgent: null })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ conversation }) => {
          this.selected = conversation;
          this.cdr.markForCheck();
        },
      });
  }

  onReplyKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.sendReply();
    }
  }

  customerName(conv: SupportConversation): string {
    const c = conv.customer;
    if (typeof c === 'object' && c !== null) {
      return `${c.firstName} ${c.lastName}`.trim() || conv.customerUid;
    }
    return conv.customerUid;
  }

  customerEmail(conv: SupportConversation): string {
    const c = conv.customer;
    return typeof c === 'object' && c !== null ? c.email : '';
  }

  customerScore(conv: SupportConversation): number | null {
    const c = conv.customer;
    return typeof c === 'object' && c !== null ? c.reputationScore : null;
  }

  statusLabel(s: string): string { return STATUS_LABELS[s as SupportConversation['status']] ?? s; }
  categoryLabel(c: string): string { return CATEGORY_LABELS[c] ?? c; }

  statusClass(s: string): string {
    const map: Record<string, string> = {
      open: 'status--open',
      pending_agent: 'status--warn',
      pending_customer: 'status--info',
      resolved: 'status--ok',
      closed: 'status--muted',
    };
    return map[s] ?? '';
  }

  isActive(conv: SupportConversation): boolean {
    return this.selected?._id === conv._id;
  }

  isResolvable(): boolean {
    return !!this.selected && this.selected.status !== 'resolved' && this.selected.status !== 'closed';
  }

  trackByConv(_: number, c: SupportConversation): string { return c._id; }
  trackByMsg (_: number, m: SupportMessage): string { return m._id; }
}
