import {
  Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef,
  DestroyRef, inject, PLATFORM_ID, ViewChild, ElementRef, AfterViewChecked,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../../auth/services/auth.service';
import { SupportService, SupportConversation, SupportMessage } from '../../services/support.service';
import { PostHogService } from '../../services/posthog.service';
import { AnalyticsEvents } from '../../services/analytics.events';

@Component({
  selector: 'app-support-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './support-chat-widget.component.html',
  styleUrls: ['./support-chat-widget.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportChatWidgetComponent implements OnInit, OnDestroy, AfterViewChecked {
  private destroyRef  = inject(DestroyRef);
  private auth        = inject(AuthService);
  private support     = inject(SupportService);
  private postHog     = inject(PostHogService);
  private cdr         = inject(ChangeDetectorRef);
  private platformId  = inject(PLATFORM_ID);
  private router      = inject(Router);

  @ViewChild('msgList') private msgListRef?: ElementRef<HTMLElement>;

  /** Hidden on Nexus — agents use the admin support page instead. */
  hiddenOnRoute = false;
  isAuthenticated = false;
  isOpen          = false;
  loading         = false;
  sending         = false;
  error: string | null = null;

  conversation: SupportConversation | null = null;
  messages: SupportMessage[] = [];
  draft       = '';
  unreadCount = 0;

  private needsScroll = false;

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.hiddenOnRoute = this.router.url.startsWith('/nexus');
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => {
      this.hiddenOnRoute = this.router.url.startsWith('/nexus');
      if (this.hiddenOnRoute) this.isOpen = false;
      this.cdr.markForCheck();
    });

    this.auth.isAuthenticated()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(auth => {
        this.isAuthenticated = auth;
        if (auth) this.loadConversation();
        else { this.conversation = null; this.messages = []; this.unreadCount = 0; }
        this.cdr.markForCheck();
      });

    this.support.onSupportMessage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ conversationId, message }) => {
        if (!this.conversation || this.conversation._id !== conversationId) return;
        if (message.senderType !== 'agent') return;
        this.messages = [...this.messages, message];
        if (!this.isOpen) this.unreadCount++;
        this.needsScroll = true;
        this.cdr.markForCheck();
      });

    this.support.onConversationUpdated()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ conversationId, status }) => {
        if (this.conversation?._id === conversationId) {
          this.conversation = { ...this.conversation, status: status as SupportConversation['status'] };
          this.cdr.markForCheck();
        }
      });
  }

  ngOnDestroy(): void {}

  ngAfterViewChecked(): void {
    if (this.needsScroll) {
      this.scrollToBottom();
      this.needsScroll = false;
    }
  }

  private scrollToBottom(): void {
    const el = this.msgListRef?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  private loadConversation(): void {
    this.support.getMyConversations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ conversations }) => {
          const active = conversations.find(c => c.status !== 'closed' && c.status !== 'resolved');
          this.conversation   = active ?? null;
          this.unreadCount    = active?.unreadByCustomer ?? 0;
          this.cdr.markForCheck();
        },
        error: () => {},
      });
  }

  open(): void {
    this.isOpen     = true;
    this.unreadCount = 0;
    this.error       = null;
    this.postHog.track(AnalyticsEvents.SUPPORT_CHAT_OPENED, { source: 'widget' });
    if (this.conversation && this.messages.length === 0) {
      this.loadMessages();
    }
    this.needsScroll = true;
  }

  close(): void { this.isOpen = false; }

  startNew(): void {
    this.conversation = null;
    this.messages = [];
    this.draft = '';
    this.error = null;
    this.cdr.markForCheck();
  }

  private loadMessages(): void {
    if (!this.conversation) return;
    this.loading = true;
    this.support.getMessages(this.conversation._id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ messages }) => {
          this.messages    = messages;
          this.loading     = false;
          this.needsScroll = true;
          this.cdr.markForCheck();
        },
        error: () => { this.loading = false; this.cdr.markForCheck(); },
      });
  }

  send(): void {
    const body = this.draft.trim();
    if (!body || this.sending) return;
    this.sending = true;
    this.error   = null;

    const afterSend = (msg: SupportMessage) => {
      this.messages    = [...this.messages, msg];
      this.draft       = '';
      this.sending     = false;
      this.needsScroll = true;
      this.cdr.markForCheck();
    };

    if (this.conversation) {
      this.support.sendMessage(this.conversation._id, body)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: ({ message }) => afterSend(message),
          error: () => {
            this.error   = 'Não foi possível enviar. Tente novamente.';
            this.sending = false;
            this.cdr.markForCheck();
          },
        });
    } else {
      this.support.openConversation({ initialMessage: body })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: ({ conversation }) => {
            this.conversation = conversation;
            // Reload messages so we see the one just sent
            this.support.getMessages(conversation._id)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: ({ messages }) => {
                  this.messages    = messages;
                  this.draft       = '';
                  this.sending     = false;
                  this.needsScroll = true;
                  this.cdr.markForCheck();
                },
              });
          },
          error: () => {
            this.error   = 'Não foi possível iniciar a conversa. Tente novamente.';
            this.sending = false;
            this.cdr.markForCheck();
          },
        });
    }
  }

  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  }

  isClosed(): boolean {
    return this.conversation?.status === 'closed' || this.conversation?.status === 'resolved';
  }

  trackByMsg(_: number, m: SupportMessage): string { return m._id; }
}
