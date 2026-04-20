import { Component, HostBinding, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  protected readonly title = signal('frontend');
  private translate = inject(TranslateService);

  @HostBinding('style.--primary-color')    readonly primaryColor    = environment.theme.primaryColor;
  @HostBinding('style.--secondary-color')  readonly secondaryColor  = environment.theme.secondaryColor;
  @HostBinding('style.--background-color') readonly backgroundColor = environment.theme.backgroundColor;

  ngOnInit(): void {
    const saved = localStorage.getItem('lang') || 'en';
    this.translate.use(saved);
  }
}
