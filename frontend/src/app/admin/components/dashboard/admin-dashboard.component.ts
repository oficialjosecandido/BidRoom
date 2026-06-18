import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin } from 'rxjs';
import {
  AdminPlatformSnapshotComparison,
  AdminService,
  AdminSnapshotComparisonMode,
  AdminStatistics
} from '../../services/admin.service';
import { AdminSidebarComponent } from '../sidebar/admin-sidebar.component';

/** Comparable numeric fields returned for each snapshot window */
type SnapshotComparableKey =
  | 'activeAccounts'
  | 'newRegistrations'
  | 'bids'
  | 'paidTransactions'
  | 'transactionAmountTotal'
  | 'bidRoomFeesTotal';

interface SnapshotDelta {
  css: string;
  text: string;
  srLabel: string;
}

interface DerivedMetric {
  label: string;
  subtitle: string;
  icon: string;
  currentFormatted: string;
  previousFormatted: string | null;
  delta: SnapshotDelta | null;
  platformWide: boolean;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, AdminSidebarComponent],
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.scss']
})
export class AdminDashboardComponent implements OnInit {
  private adminService = inject(AdminService);

  statistics: AdminStatistics | null = null;
  snapshotComparison: AdminPlatformSnapshotComparison | null = null;

  isLoading = true;
  snapshotLoading = false;
  error: string | null = null;
  snapshotError: string | null = null;

  readonly statusOrder = ['draft', 'active', 'ended', 'cancelled'] as const;

  readonly comparisonModes: AdminSnapshotComparisonMode[] = [
    'today_vs_yesterday',
    'week_vs_week',
    'month_vs_month',
    'year_vs_year'
  ];

  comparisonMode: AdminSnapshotComparisonMode = 'today_vs_yesterday';

  ngOnInit(): void {
    this.loadDashboard();
  }

  loadDashboard(): void {
    this.isLoading = true;
    this.snapshotLoading = false;
    this.error = null;
    this.snapshotError = null;

    forkJoin({
      stats: this.adminService.getStatistics(),
      snapshot: this.adminService.getPlatformSnapshotComparison(this.comparisonMode)
    }).subscribe({
      next: ({ stats, snapshot }) => {
        this.statistics = {
          ...stats,
          listingsByStatus: stats.listingsByStatus ?? {},
          listingsByAuctionSegment: stats.listingsByAuctionSegment ?? {
            bestOffer: 0,
            highestBid: 0,
            highestBidPrivateRoom: 0
          },
          totalListingsAllStatuses:
            stats.totalListingsAllStatuses ?? this.sumStatuses(stats.listingsByStatus),
          openDisputes: stats.openDisputes ?? 0,
          totalTransactions: stats.totalTransactions ?? 0
        };
        this.snapshotComparison = snapshot;
        this.isLoading = false;
      },
      error: (err) => {
        this.error = err?.message || 'Failed to load dashboard';
        this.isLoading = false;
      }
    });
  }

  refreshDashboard(): void {
    this.loadDashboard();
  }

  selectComparison(mode: AdminSnapshotComparisonMode): void {
    if (mode === this.comparisonMode || this.snapshotLoading || this.isLoading) return;
    this.comparisonMode = mode;
    this.snapshotLoading = true;
    this.snapshotError = null;

    this.adminService.getPlatformSnapshotComparison(mode).subscribe({
      next: (snapshot) => {
        this.snapshotComparison = snapshot;
        this.snapshotLoading = false;
      },
      error: (err) => {
        const msg =
          err?.error?.message ||
          err?.error?.error ||
          err?.message ||
          'Failed to load snapshot';
        this.snapshotError = typeof msg === 'string' ? msg : 'Failed to load snapshot';
        this.snapshotLoading = false;
      }
    });
  }

  comparisonModeLabel(mode: AdminSnapshotComparisonMode): string {
    const labels: Record<AdminSnapshotComparisonMode, string> = {
      today_vs_yesterday: 'Today vs yesterday',
      week_vs_week: 'This week vs last week',
      month_vs_month: 'This month vs last month',
      year_vs_year: 'This year vs last year'
    };
    return labels[mode];
  }

  snapshotDelta(key: SnapshotComparableKey): SnapshotDelta {
    const snap = this.snapshotComparison;
    if (!snap) {
      return { css: '', text: '', srLabel: '' };
    }
    const cur = Number(snap.current[key]);
    const prev = Number(snap.previous[key]);
    return this.deltaFromValues(cur, prev);
  }

  /**
   * Current value vs previous window: ↑/↓ percentage, or neutral when undefined.
   */
  private deltaFromValues(current: number, previous: number): SnapshotDelta {
    const eps = 1e-9;
    const prevN = Number.isFinite(previous) ? previous : 0;
    const curN = Number.isFinite(current) ? current : 0;

    if (Math.abs(prevN) < eps && Math.abs(curN) < eps) {
      return {
        css: 'delta-chip delta-chip-na',
        text: '—',
        srLabel: 'No change versus previous period; both zero'
      };
    }
    if (Math.abs(prevN) < eps && curN > eps) {
      return {
        css: 'delta-chip delta-chip-new',
        text: '↑ new',
        srLabel: 'Up from zero in the previous period'
      };
    }
    if (Math.abs(prevN) < eps && curN < -eps) {
      return {
        css: 'delta-chip delta-chip-down',
        text: '↓',
        srLabel: 'Decreased from zero baseline'
      };
    }

    const pct = ((curN - prevN) / prevN) * 100;
    if (!Number.isFinite(pct)) {
      return { css: 'delta-chip delta-chip-na', text: '—', srLabel: 'Change not applicable' };
    }

    const rounded = Math.round(pct * 10) / 10;
    if (Math.abs(rounded) < 0.05) {
      return {
        css: 'delta-chip delta-chip-flat',
        text: '→ 0%',
        srLabel: 'Flat versus previous period, about zero percent change'
      };
    }

    const mag = Math.abs(rounded);
    const text =
      pct > 0 ? `↑ ${mag}%` : `↓ ${mag}%`;
    const cls =
      pct > 0 ? 'delta-chip delta-chip-up' : 'delta-chip delta-chip-down';
    return {
      css: cls,
      text,
      srLabel: `${pct > 0 ? 'Up' : 'Down'} ${mag} percent versus previous period`
    };
  }

  listingStatusRows(): { key: string; label: string; count: number }[] {
    const m = this.statistics?.listingsByStatus ?? {};
    return this.statusOrder.map((key) => ({
      key,
      label: this.statusLabel(key),
      count: m[key] ?? 0
    }));
  }

  listingAuctionRows(): { key: string; label: string; hint?: string; count: number }[] {
    const seg = this.statistics?.listingsByAuctionSegment;
    return [
      { key: 'best-offer', label: 'Best offer', count: seg?.bestOffer ?? 0 },
      {
        key: 'highest-bid',
        label: 'Highest bid',
        hint: 'Standard (no private room)',
        count: seg?.highestBid ?? 0
      },
      {
        key: 'highest-bid-private',
        label: 'Highest bid',
        hint: 'Private room enabled',
        count: seg?.highestBidPrivateRoom ?? 0
      }
    ];
  }

  auctionInventoryTotal(): number {
    const seg = this.statistics?.listingsByAuctionSegment;
    if (!seg) return 0;
    return (seg.bestOffer ?? 0) + (seg.highestBid ?? 0) + (seg.highestBidPrivateRoom ?? 0);
  }

  get derivedMetrics(): DerivedMetric[] {
    const snap = this.snapshotComparison;
    const stats = this.statistics;
    const out: DerivedMetric[] = [];

    if (snap) {
      // 1. Take rate: fees / GMV
      const cGMV = snap.current.transactionAmountTotal;
      const cFees = snap.current.bidRoomFeesTotal;
      const pGMV = snap.previous.transactionAmountTotal;
      const pFees = snap.previous.bidRoomFeesTotal;
      const cRate = cGMV > 0 ? (cFees / cGMV) * 100 : 0;
      const pRate = pGMV > 0 ? (pFees / pGMV) * 100 : 0;
      out.push({
        label: 'Take rate',
        subtitle: 'Receita ÷ GMV · margem efectiva',
        icon: '📊',
        currentFormatted: cGMV > 0 ? `${cRate.toFixed(2)}%` : '—',
        previousFormatted: pGMV > 0 ? `${pRate.toFixed(2)}%` : '—',
        delta: this.deltaFromValues(cRate, pRate),
        platformWide: false
      });

      // 2. AOV: GMV / paidTransactions
      const cTx = snap.current.paidTransactions;
      const cAOV = cTx > 0 ? cGMV / cTx : 0;
      const pTx = snap.previous.paidTransactions;
      const pAOV = pTx > 0 ? pGMV / pTx : 0;
      out.push({
        label: 'Valor médio (AOV)',
        subtitle: 'GMV ÷ transacções pagas',
        icon: '💎',
        currentFormatted: cTx > 0 ? this.formatEUR(cAOV) : '—',
        previousFormatted: pTx > 0 ? this.formatEUR(pAOV) : '—',
        delta: this.deltaFromValues(cAOV, pAOV),
        platformWide: false
      });

      // 3. Bids per transaction (auction liquidity proxy)
      const cBids = snap.current.bids;
      const pBids = snap.previous.bids;
      const cBPT = cTx > 0 ? cBids / cTx : 0;
      const pBPT = pTx > 0 ? pBids / pTx : 0;
      out.push({
        label: 'Lances / transacção',
        subtitle: 'Liquidez do leilão · bids por venda',
        icon: '⚡',
        currentFormatted: cTx > 0 ? cBPT.toFixed(1) : '—',
        previousFormatted: pTx > 0 ? pBPT.toFixed(1) : '—',
        delta: this.deltaFromValues(cBPT, pBPT),
        platformWide: false
      });
    }

    if (stats) {
      // 4. Dispute rate: open disputes / total transactions (platform-wide)
      const totalTx = stats.totalTransactions;
      const disputes = stats.openDisputes;
      out.push({
        label: 'Taxa de disputa',
        subtitle: 'Disputas abertas ÷ total transacções',
        icon: '⚠️',
        currentFormatted: totalTx > 0 ? `${((disputes / totalTx) * 100).toFixed(2)}%` : '—',
        previousFormatted: null,
        delta: null,
        platformWide: true
      });

      // 5. Listing conversion: total transactions / published listings (platform-wide)
      const auctions = stats.totalAuctions;
      out.push({
        label: 'Conversão',
        subtitle: 'Vendas concluídas ÷ listings publicados',
        icon: '🎯',
        currentFormatted: auctions > 0 ? `${((stats.totalTransactions / auctions) * 100).toFixed(1)}%` : '—',
        previousFormatted: null,
        delta: null,
        platformWide: true
      });
    }

    return out;
  }

  private formatEUR(amount: number): string {
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(amount);
  }

  private sumStatuses(by?: Record<string, number>): number {
    if (!by) return 0;
    return Object.values(by).reduce((a, n) => a + (typeof n === 'number' ? n : 0), 0);
  }

  private statusLabel(key: string): string {
    const labels: Record<string, string> = {
      draft: 'Draft',
      active: 'Active',
      ended: 'Ended',
      cancelled: 'Cancelled'
    };
    return labels[key] ?? key;
  }
}
