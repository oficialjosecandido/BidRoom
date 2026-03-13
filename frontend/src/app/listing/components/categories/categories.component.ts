import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { CATEGORIES, Category } from '../../../shared/config/categories.config';

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss'
})
export class CategoriesComponent {
  private router = inject(Router);
  categories: Category[] = CATEGORIES;

  browseCategory(categoryId: string): void {
    this.router.navigate(['/listing/list'], { queryParams: { category: categoryId } });
  }

  browseSubCategory(categoryId: string, subCategory: string): void {
    this.router.navigate(['/listing/list'], { queryParams: { category: categoryId, subCategory } });
  }
}
