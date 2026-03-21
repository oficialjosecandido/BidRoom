import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private translate = inject(TranslateService);

  ngOnInit(): void {
    const saved = localStorage.getItem('lang') || 'en';
    this.translate.use(saved);
  }
}
