import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';

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
