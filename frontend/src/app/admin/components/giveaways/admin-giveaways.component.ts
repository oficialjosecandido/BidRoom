import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { Subscription, switchMap, of } from 'rxjs';
import Swal from 'sweetalert2';
import {
  AdminService,
  AdminGiveaway,
  AdminGiveawayEntry,
  AdminCreateGiveawayPayload,
  AdminGiveawayDrawVideo
} from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';
import { CATEGORIES } from '../../../shared/config/categories.config';
import { formatEntryNumber } from '../../../shared/services/giveaway.service';

interface GiveawayDraft {
  title: string;
  description: string;
  category: string;
  subCategory: string;
  condition: string;
  duration: string;
  shippingOption: 'free' | 'local-pickup';
  locationCity: string;
  locationCountry: string;
}

/**
 * Giveaways run by BidRoom itself.
 *
 * Creating one goes through the ordinary listing route (where the admin-only
 * and free-entry rules are enforced) and lands in the review queue like any
 * listing. Drawing happens here, once, on the server — this page only asks for
 * it and shows the result, so there is nothing to re-roll from the browser.
 *
 * The draw is meant to be filmed and the video published, so participants'
 * names and emails stay hidden on this page until the admin chooses to show
 * them — a recording made with the defaults shows entry numbers and public
 * names only.
 */
@Component({
  selector: 'app-admin-giveaways',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminSidebarComponent],
  templateUrl: './admin-giveaways.component.html',
  styleUrls: ['./admin-giveaways.component.scss']
})
export class AdminGiveawaysComponent implements OnInit, OnDestroy {
  private adminService = inject(AdminService);

  readonly formatEntryNumber = formatEntryNumber;

  giveaways: AdminGiveaway[] = [];
  total = 0;
  isLoading = true;
  error: string | null = null;
  phase = 'all';

  readonly PHASE_OPTIONS: { value: string; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Awaiting approval' },
    { value: 'open', label: 'Open for entries' },
    { value: 'closed', label: 'Closed — ready to draw' },
    { value: 'drawn', label: 'Drawn' }
  ];

  readonly PHASE_LABELS: Record<string, string> = {
    pending: 'Awaiting approval',
    open: 'Open',
    closed: 'Ready to draw',
    drawn: 'Drawn',
    cancelled: 'Cancelled'
  };

  // Detail
  selected: AdminGiveaway | null = null;
  entries: AdminGiveawayEntry[] = [];
  entriesTotal = 0;
  entriesPage = 1;
  entriesPages = 1;
  entriesLoading = false;
  entriesError: string | null = null;
  drawing = false;
  approvingId: string | null = null;
  private readonly ENTRIES_PAGE_SIZE = 100;

  /** Full names and emails. Off by default and every time a giveaway is opened. */
  showPersonalData = false;

  // Winner email
  emailingWinner = false;

  // Draw video
  videoMode: 'upload' | 'link' = 'upload';
  replacingVideo = false;
  videoFile: File | null = null;
  videoLink = '';
  videoBusy = false;
  videoProgress: number | null = null;
  videoError: string | null = null;
  private videoUpload: Subscription | null = null;
  readonly MAX_VIDEO_BYTES = 200 * 1024 * 1024;
  readonly VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm';

  // Create
  showCreate = false;
  creating = false;
  createError: string | null = null;
  draft: GiveawayDraft = this.emptyDraft();
  imageFiles: File[] = [];
  imagePreviews: string[] = [];
  readonly MAX_IMAGES = 10;
  readonly MIN_DESCRIPTION = 50;

  /**
   * Vehicles and property are left out: handing either over as a prize carries
   * transfer and tax obligations this format does not cover. The API refuses
   * them too — this only avoids offering a choice that would fail.
   */
  readonly categories = CATEGORIES.filter(c => c.id !== 'vehicles' && c.id !== 'real-estate');
  readonly CONDITIONS = ['New', 'Used - Excellent', 'Used - Very Good', 'Used - Good', 'Used - Fair', 'For Parts or Not Working'];
  readonly DURATIONS = ['24 hours', '3 days', '7 days', '10 days', '15 days', '30 days'];

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.revokePreviews();
    this.videoUpload?.unsubscribe();
  }

  load(): void {
    this.isLoading = true;
    this.error = null;
    this.adminService.getGiveaways({ phase: this.phase, limit: 100 }).subscribe({
      next: (res) => {
        this.giveaways = res.giveaways;
        this.total = res.total;
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load giveaways';
        this.isLoading = false;
      }
    });
  }

  // ── Detail ──────────────────────────────────────────────────────────────

  open(g: AdminGiveaway): void {
    this.selected = g;
    this.entries = [];
    this.entriesPage = 1;
    this.showPersonalData = false;
    this.resetVideoForm();
    this.loadEntries(1);
  }

  closeDetail(): void {
    this.cancelVideoUpload();
    this.selected = null;
    this.entries = [];
    this.showPersonalData = false;
  }

  loadEntries(page: number): void {
    if (!this.selected) return;
    const id = this.selected._id;
    this.entriesLoading = true;
    this.entriesError = null;
    this.adminService.getGiveawayEntries(id, { page, limit: this.ENTRIES_PAGE_SIZE }).subscribe({
      next: (res) => {
        if (this.selected?._id !== id) return;
        this.selected = res.giveaway;
        this.entries = res.entries;
        this.entriesTotal = res.total;
        this.entriesPage = res.page;
        this.entriesPages = res.pages;
        this.entriesLoading = false;
      },
      error: (err) => {
        this.entriesError = err?.error?.error || 'Failed to load entries';
        this.entriesLoading = false;
      }
    });
  }

  canDraw(g: AdminGiveaway): boolean {
    return g.phase === 'closed' && g.totalEntries > 0;
  }

  /** Why the draw button is not offered, in the reviewer's terms. */
  drawBlockedReason(g: AdminGiveaway): string | null {
    switch (g.phase) {
      case 'pending': return 'Approve the giveaway first. Entries open when it is published.';
      case 'open': return `Entries are still open until ${this.formatDate(g.endDate)}. The draw is available once they close.`;
      case 'cancelled': return 'This giveaway was cancelled.';
      case 'closed': return g.totalEntries > 0 ? null : 'Nobody entered, so there is nobody to draw.';
      default: return null;
    }
  }

  async draw(): Promise<void> {
    const g = this.selected;
    if (!g || this.drawing || !this.canDraw(g)) return;

    const confirm = await Swal.fire({
      icon: 'warning',
      title: 'Draw the winner?',
      html:
        `<p>One entry out of <strong>${g.totalEntries}</strong> will be picked at random by the server for ` +
        `<strong>${this.escape(this.titleOf(g))}</strong>.</p>` +
        `<p>This happens once and cannot be redone. Your email is recorded as the person who ran it, ` +
        `and every participant is notified of the winning number.</p>`,
      showCancelButton: true,
      confirmButtonText: 'Draw now',
      cancelButtonText: 'Cancel',
      reverseButtons: true,
      focusCancel: true
    });
    if (!confirm.isConfirmed) return;

    this.drawing = true;
    this.adminService.drawGiveaway(g._id).subscribe({
      next: (res) => {
        this.drawing = false;
        // Only what the public page shows: this dialog is likely on camera.
        const emailLine = {
          sent: 'The winner was notified in the app and by email.',
          failed: 'The winner was notified in the app, but <strong>the email could not be sent</strong>. Use “Send email” in the result to try again.',
          pending: 'The winner was notified in the app. The email is still being sent — the result will show when it has gone.'
        }[res.winnerEmail] ?? '';
        Swal.fire({
          icon: res.winnerEmail === 'failed' ? 'warning' : 'success',
          title: `Winning entry #${formatEntryNumber(res.winnerEntry)}`,
          html:
            `<p>Shown publicly as <strong>${this.escape(res.winner.publicName)}</strong>.</p>` +
            `<p>${emailLine}</p>` +
            `<p>Next: publish the video of the draw on the giveaway page.</p>`
        });
        this.loadEntries(this.entriesPage);
        this.load();
      },
      error: (err) => {
        this.drawing = false;
        Swal.fire({ icon: 'error', title: 'The draw did not run', text: this.drawErrorMessage(err) });
        this.loadEntries(this.entriesPage);
        this.load();
      }
    });
  }

  private drawErrorMessage(err: { error?: { error?: string; message?: string; position?: number } }): string {
    switch (err?.error?.error) {
      case 'giveaway_already_drawn':
        return 'A winner was already drawn — possibly by another admin just now. The result below is the one that counts.';
      case 'giveaway_still_open':
        return 'Entries have not closed yet. Try again after the closing time.';
      case 'giveaway_no_entries':
        return 'Nobody entered this giveaway, so there is nobody to draw.';
      case 'giveaway_winner_unavailable':
        return 'The drawn entry belongs to an account that no longer exists. Nothing was saved. Review the entries before drawing again.';
      case 'giveaway_not_found':
        return 'This giveaway no longer exists.';
      default:
        return err?.error?.message || err?.error?.error || 'Something went wrong. Nothing was saved.';
    }
  }

  // ── Winner email ────────────────────────────────────────────────────────

  async emailWinner(): Promise<void> {
    const g = this.selected;
    if (!g || this.emailingWinner || !g.giveaway?.drawnAt) return;

    if (g.giveaway.winnerEmailedAt) {
      const confirm = await Swal.fire({
        icon: 'question',
        title: 'Send the winner email again?',
        text: `It was already sent ${this.formatDate(g.giveaway.winnerEmailedAt)}. Send it again only if the winner says it did not arrive.`,
        showCancelButton: true,
        confirmButtonText: 'Send again',
        cancelButtonText: 'Cancel',
        reverseButtons: true
      });
      if (!confirm.isConfirmed) return;
    }

    const id = g._id;
    this.emailingWinner = true;
    this.adminService.emailGiveawayWinner(id).subscribe({
      next: (res) => {
        this.emailingWinner = false;
        if (this.selected?._id === id && this.selected.giveaway) {
          this.selected = { ...this.selected, giveaway: { ...this.selected.giveaway, winnerEmailedAt: res.winnerEmailedAt } };
        }
        Swal.fire({ icon: 'success', title: 'Email sent', text: 'The winner email was sent to their account address.', timer: 2500, showConfirmButton: false });
      },
      error: (err) => {
        this.emailingWinner = false;
        Swal.fire({
          icon: 'error',
          title: 'The email was not sent',
          text: err?.error?.error === 'giveaway_email_failed'
            ? 'The mail server refused it. Try again in a few minutes.'
            : err?.error?.message || 'Something went wrong.'
        });
      }
    });
  }

  // ── Draw video ──────────────────────────────────────────────────────────

  get currentVideo(): AdminGiveawayDrawVideo | null {
    const v = this.selected?.giveaway?.drawVideo;
    return v?.url ? v : null;
  }

  get showVideoForm(): boolean {
    return !!this.selected?.giveaway?.drawnAt && (!this.currentVideo || this.replacingVideo);
  }

  videoTypeLabel(type: AdminGiveawayDrawVideo['type']): string {
    const labels: Record<string, string> = { upload: 'Uploaded video', youtube: 'YouTube', instagram: 'Instagram' };
    return (type && labels[type]) || '—';
  }

  /** A first guess for the reviewer. The API decides; this only saves a round trip for obvious mistakes. */
  get linkKind(): 'youtube' | 'instagram' | 'unknown' | null {
    const raw = this.videoLink.trim();
    if (!raw) return null;
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:') return 'unknown';
      const host = u.hostname.toLowerCase();
      if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) return 'youtube';
      if (['instagram.com', 'www.instagram.com'].includes(host)) return 'instagram';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  onVideoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.videoError = null;
    if (!file) return;
    if (!/\.(mp4|m4v|mov|webm)$/i.test(file.name)) {
      this.videoFile = null;
      this.videoError = 'Choose an MP4, MOV or WebM video.';
      return;
    }
    if (file.size > this.MAX_VIDEO_BYTES) {
      this.videoFile = null;
      this.videoError = `That video is ${this.formatBytes(file.size)}. The limit is 200 MB — trim or compress it, or publish it on YouTube and paste the link.`;
      return;
    }
    this.videoFile = file;
  }

  uploadVideo(): void {
    const g = this.selected;
    if (!g || this.videoBusy || !this.videoFile) return;
    const id = g._id;
    this.videoBusy = true;
    this.videoProgress = 0;
    this.videoError = null;

    this.videoUpload = this.adminService.uploadGiveawayDrawVideo(id, this.videoFile).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          this.videoProgress = event.total ? Math.round((100 * event.loaded) / event.total) : null;
        } else if (event.type === HttpEventType.Response && event.body) {
          this.onVideoPublished(id, event.body.drawVideo);
        }
      },
      error: (err) => {
        this.videoBusy = false;
        this.videoProgress = null;
        this.videoUpload = null;
        this.videoError = this.videoErrorMessage(err);
      },
      complete: () => {
        this.videoUpload = null;
      }
    });
  }

  cancelVideoUpload(): void {
    if (!this.videoUpload) return;
    this.videoUpload.unsubscribe();
    this.videoUpload = null;
    this.videoBusy = false;
    this.videoProgress = null;
  }

  publishVideoLink(): void {
    const g = this.selected;
    const url = this.videoLink.trim();
    if (!g || this.videoBusy || !url) return;
    if (this.linkKind === 'unknown') {
      this.videoError = 'Paste an https link to a YouTube video or an Instagram post or reel.';
      return;
    }
    const id = g._id;
    this.videoBusy = true;
    this.videoError = null;
    this.adminService.publishGiveawayDrawVideoLink(id, url).subscribe({
      next: (res) => this.onVideoPublished(id, res.drawVideo),
      error: (err) => {
        this.videoBusy = false;
        this.videoError = this.videoErrorMessage(err);
      }
    });
  }

  startReplacingVideo(): void {
    this.resetVideoForm();
    this.replacingVideo = true;
  }

  stopReplacingVideo(): void {
    if (this.videoBusy) return;
    this.resetVideoForm();
  }

  async removeVideo(): Promise<void> {
    const g = this.selected;
    if (!g || this.videoBusy || !this.currentVideo) return;
    const confirm = await Swal.fire({
      icon: 'warning',
      title: 'Remove the draw video?',
      text: 'It disappears from the giveaway page straight away. The removal is recorded.',
      showCancelButton: true,
      confirmButtonText: 'Remove',
      cancelButtonText: 'Cancel',
      reverseButtons: true,
      focusCancel: true
    });
    if (!confirm.isConfirmed) return;

    const id = g._id;
    this.videoBusy = true;
    this.adminService.removeGiveawayDrawVideo(id).subscribe({
      next: () => {
        this.videoBusy = false;
        if (this.selected?._id === id && this.selected.giveaway) {
          this.selected = { ...this.selected, giveaway: { ...this.selected.giveaway, drawVideo: null } };
        }
        this.resetVideoForm();
      },
      error: (err) => {
        this.videoBusy = false;
        Swal.fire({ icon: 'error', title: 'Could not remove the video', text: err?.error?.message || 'Something went wrong.' });
      }
    });
  }

  private onVideoPublished(id: string, drawVideo: AdminGiveawayDrawVideo): void {
    this.videoBusy = false;
    this.videoProgress = null;
    if (this.selected?._id === id && this.selected.giveaway) {
      this.selected = { ...this.selected, giveaway: { ...this.selected.giveaway, drawVideo } };
    }
    this.resetVideoForm();
    Swal.fire({ icon: 'success', title: 'Video published', text: 'It now shows in the result on the giveaway page.', timer: 2500, showConfirmButton: false });
  }

  private resetVideoForm(): void {
    this.replacingVideo = false;
    this.videoFile = null;
    this.videoLink = '';
    this.videoError = null;
    this.videoProgress = null;
  }

  private videoErrorMessage(err: { status?: number; error?: { error?: string; message?: string } }): string {
    switch (err?.error?.error) {
      case 'giveaway_video_invalid_url':
        return 'That link was not accepted. Use an https link to a YouTube video, or to an Instagram post or reel.';
      case 'giveaway_video_invalid_type':
        return 'That file is not an MP4, MOV or WebM video.';
      case 'giveaway_video_too_large':
        return 'The video must be 200 MB or less. Trim or compress it, or publish it on YouTube and paste the link.';
      case 'giveaway_video_missing':
        return 'Choose a video file to upload.';
      case 'giveaway_not_drawn':
        return 'Draw the winner before publishing the video.';
      case 'giveaway_not_found':
        return 'This giveaway no longer exists.';
      case 'storage_not_configured':
        return 'Video storage is not set up on this server. Publish the video on YouTube and paste the link instead.';
      default:
        if (err?.status === 413) return 'The video is too large for the server to accept. Publish it on YouTube and paste the link instead.';
        if (err?.status === 0) return 'The upload was interrupted. Check the connection and try again.';
        return err?.error?.message || 'Something went wrong. Nothing was published.';
    }
  }

  formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  async approve(g: AdminGiveaway): Promise<void> {
    if (this.approvingId) return;
    const confirm = await Swal.fire({
      icon: 'question',
      title: 'Publish this giveaway?',
      html:
        `<p><strong>${this.escape(this.titleOf(g))}</strong> goes live and entries open now. ` +
        `The entry period starts from this moment, not from when it was created.</p>` +
        `<p>Check the rules tab on the listing reads correctly before publishing.</p>`,
      showCancelButton: true,
      confirmButtonText: 'Publish',
      cancelButtonText: 'Cancel',
      reverseButtons: true
    });
    if (!confirm.isConfirmed) return;

    this.approvingId = g._id;
    this.adminService.approveListing(g._id).subscribe({
      next: (res) => {
        this.approvingId = null;
        Swal.fire({
          icon: 'success',
          title: 'Published',
          text: res.listing.endDate ? `Entries close ${this.formatDate(res.listing.endDate)}.` : 'The giveaway is live.'
        });
        if (this.selected?._id === g._id) this.loadEntries(1);
        this.load();
      },
      error: (err) => {
        this.approvingId = null;
        Swal.fire({ icon: 'error', title: 'Could not publish', text: err?.error?.error || 'Something went wrong.' });
      }
    });
  }

  // ── Create ──────────────────────────────────────────────────────────────

  openCreate(): void {
    this.draft = this.emptyDraft();
    this.clearImages();
    this.createError = null;
    this.showCreate = true;
  }

  closeCreate(): void {
    if (this.creating) return;
    this.showCreate = false;
    this.clearImages();
  }

  get subCategories(): string[] {
    return this.categories.find(c => c.id === this.draft.category)?.subCategories ?? [];
  }

  onCategoryChange(): void {
    this.draft.subCategory = this.subCategories[0] ?? '';
  }

  onImagesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []).filter(f => f.type.startsWith('image/'));
    const room = this.MAX_IMAGES - this.imageFiles.length;
    for (const file of picked.slice(0, Math.max(0, room))) {
      this.imageFiles.push(file);
      this.imagePreviews.push(URL.createObjectURL(file));
    }
    input.value = '';
  }

  removeImage(index: number): void {
    URL.revokeObjectURL(this.imagePreviews[index]);
    this.imageFiles.splice(index, 1);
    this.imagePreviews.splice(index, 1);
  }

  /** The first thing that stops the form from being sent, or null. */
  get createProblem(): string | null {
    const d = this.draft;
    if (!d.title.trim()) return 'Add a title.';
    if (d.description.trim().length < this.MIN_DESCRIPTION) {
      return `The description needs at least ${this.MIN_DESCRIPTION} characters — it is what participants read about the prize.`;
    }
    if (!d.category || !d.subCategory) return 'Choose a category.';
    if (!d.condition) return 'Choose the condition of the prize.';
    if (!d.locationCity.trim()) return 'Add the city the prize ships from or is collected in.';
    if (this.imageFiles.length === 0) return 'Add at least one photo of the prize.';
    return null;
  }

  create(): void {
    if (this.creating) return;
    const problem = this.createProblem;
    if (problem) {
      this.createError = problem;
      return;
    }
    const d = this.draft;
    this.creating = true;
    this.createError = null;

    this.adminService.uploadImages(this.imageFiles).pipe(
      switchMap(({ urls }) => {
        if (!urls?.length) return of(null);
        const payload: AdminCreateGiveawayPayload = {
          saleFormat: 'giveaway',
          title: d.title.trim(),
          description: d.description.trim(),
          category: d.category,
          subCategory: d.subCategory,
          condition: d.condition,
          duration: d.duration,
          shippingOption: d.shippingOption,
          locationCity: d.locationCity.trim(),
          locationCountry: d.locationCountry,
          location: `${d.locationCity.trim()}, ${d.locationCountry}`,
          images: urls
        };
        return this.adminService.createGiveaway(payload);
      })
    ).subscribe({
      next: (listing) => {
        this.creating = false;
        if (!listing) {
          this.createError = 'The photos did not upload. Try again.';
          return;
        }
        this.showCreate = false;
        this.clearImages();
        this.phase = 'pending';
        this.load();
        Swal.fire({
          icon: 'success',
          title: 'Giveaway created',
          html:
            '<p>It is waiting for approval and is not visible yet.</p>' +
            '<p>Open the listing to check the text and the rules tab, then publish it from here. ' +
            'Entries open — and the clock starts — when it is published.</p>'
        });
      },
      error: (err) => {
        this.creating = false;
        this.createError = err?.error?.message || err?.error?.error || 'Could not create the giveaway.';
      }
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  titleOf(g: AdminGiveaway): string {
    return g.titlePt || g.title;
  }

  phaseLabel(p: string): string {
    return this.PHASE_LABELS[p] ?? p;
  }

  personName(p: { firstName: string; lastName: string } | null | undefined): string {
    if (!p) return '—';
    return `${p.firstName || ''} ${p.lastName || ''}`.trim() || '—';
  }

  /** The same minimal form the public page shows: first name and last initial. */
  publicName(p: { firstName: string; lastName: string } | null | undefined): string {
    if (!p) return '—';
    const initial = p.lastName ? ` ${p.lastName.charAt(0).toUpperCase()}.` : '';
    return `${p.firstName || ''}${initial}`.trim() || '—';
  }

  formatDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }

  private escape(s: string): string {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  }

  private emptyDraft(): GiveawayDraft {
    const first = CATEGORIES.find(c => c.id === 'electronics');
    return {
      title: '',
      description: '',
      category: first?.id ?? '',
      subCategory: first?.subCategories[0] ?? '',
      condition: 'New',
      duration: '7 days',
      shippingOption: 'free',
      locationCity: '',
      locationCountry: 'PT'
    };
  }

  private clearImages(): void {
    this.revokePreviews();
    this.imageFiles = [];
    this.imagePreviews = [];
  }

  private revokePreviews(): void {
    this.imagePreviews.forEach(url => URL.revokeObjectURL(url));
  }
}
