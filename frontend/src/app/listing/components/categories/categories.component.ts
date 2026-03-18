import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';
import { CATEGORIES, Category } from '../../../shared/config/categories.config';
import { CONDITION_OPTIONS, SHIPPING_OPTIONS, LOCATION_OPTIONS } from '../listing-list/listing-list.component';

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, HeaderComponent, FooterComponent],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.scss'
})
export class CategoriesComponent {
  private router = inject(Router);
  categories: Category[] = CATEGORIES;

  readonly conditionOptions = CONDITION_OPTIONS;
  readonly shippingOptions = SHIPPING_OPTIONS;
  readonly locationOptions = LOCATION_OPTIONS;

  selectedConditions: Set<string> = new Set();
  selectedShipping: Set<string> = new Set();
  selectedLocation = '';
  minPrice = '';
  maxPrice = '';

  get hasActiveFilters(): boolean {
    return !!(this.selectedConditions.size || this.selectedShipping.size || this.selectedLocation || this.minPrice || this.maxPrice);
  }

  private buildFilterParams(): Record<string, string> {
    const params: Record<string, string> = {};
    if (this.selectedConditions.size) params['condition'] = [...this.selectedConditions].join(',');
    if (this.selectedShipping.size) params['shipping'] = [...this.selectedShipping].join(',');
    if (this.selectedLocation) params['location'] = this.selectedLocation;
    if (this.minPrice) params['minPrice'] = this.minPrice;
    if (this.maxPrice) params['maxPrice'] = this.maxPrice;
    return params;
  }

  toggleCondition(key: string): void {
    if (this.selectedConditions.has(key)) {
      this.selectedConditions.delete(key);
    } else {
      this.selectedConditions.add(key);
    }
    this.selectedConditions = new Set(this.selectedConditions);
  }

  toggleShipping(key: string): void {
    if (this.selectedShipping.has(key)) {
      this.selectedShipping.delete(key);
    } else {
      this.selectedShipping.add(key);
    }
    this.selectedShipping = new Set(this.selectedShipping);
  }

  clearFilters(): void {
    this.selectedConditions = new Set();
    this.selectedShipping = new Set();
    this.selectedLocation = '';
    this.minPrice = '';
    this.maxPrice = '';
  }

  browseCategory(categoryId: string): void {
    this.router.navigate(['/listing/list'], {
      queryParams: { category: categoryId, ...this.buildFilterParams() }
    });
  }

  browseSubCategory(categoryId: string, subCategory: string): void {
    this.router.navigate(['/listing/list'], {
      queryParams: { category: categoryId, subCategory, ...this.buildFilterParams() }
    });
  }

  browseAll(): void {
    this.router.navigate(['/listing/list'], { queryParams: this.buildFilterParams() });
  }
}
