import { Component, OnInit, OnDestroy, AfterViewInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { ListingsService, Listing, ListingsQueryParams, StatsOverview } from '../../../shared/services/listings.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, OnDestroy {
  isLight = false;
  private pvtSeconds = 47;
  private timerId: ReturnType<typeof setInterval> | null = null;

  readonly enableAuctions = environment.enableAuctions;
  readonly enablePrivateRooms = environment.enablePrivateRooms;

  listings: Listing[] = [];
  loading = true;
  error: string | null = null;
  sortBy: 'deadline' | 'newest' | 'highest' | 'lowest' | 'bids' = 'deadline';
  selectedCategory = '';
  stats: StatsOverview = {
    totalBidders: 0,
    activeListings: 0,
    totalValueTraded: 0
  };

  get themeLabel(): string {
    return this.isLight ? 'Modo claro' : 'Modo escuro';
  }

  get privateTimerDisplay(): string {
    const m = Math.floor(this.pvtSeconds / 60);
    const s = this.pvtSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  ngOnInit(): void {
    this.timerId = setInterval(() => {
      this.pvtSeconds = Math.max(0, this.pvtSeconds - 1);
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
    }
  }

  toggleTheme(): void {
    this.isLight = !this.isLight;
  }
}
