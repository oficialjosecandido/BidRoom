import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import Swal from 'sweetalert2';
import { HttpClient } from '@angular/common/http';
import { TranslateModule } from '@ngx-translate/core';
import { ListingsService, Listing } from '../../../shared/services/listings.service';
import { API_CONFIG } from '../../../shared/config/api.config';
import { HeaderComponent } from '../../../shared/components/header/header.component';
import { FooterComponent } from '../../../shared/components/footer/footer.component';

export type EditMode = 'full' | 'partial' | 'locked';

@Component({
  selector: 'app-edit-listing',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, RouterLink, HeaderComponent, FooterComponent],
  templateUrl: './edit-listing.html',
  styleUrl: './edit-listing.scss'
})
export class EditListing implements OnInit {
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private listingsService = inject(ListingsService);
  private http = inject(HttpClient);

  listing: Listing | null = null;
  editMode: EditMode = 'locked';
  editForm!: FormGroup;
  isLoading = true;
  isSubmitting = false;
  errorMessage = '';
  isUploadingImages = false;

  uploadedFiles: File[] = [];
  previewUrls: (string | ArrayBuffer | null)[] = [];
  existingImageUrls: string[] = [];

  shippingOptions = [
    { value: 'flat-rate',    label: 'Flat Rate'       },
    { value: 'calculated',   label: 'Calculated'      },
    { value: 'local-pickup', label: 'Meet in Person'  },
    { value: 'free',         label: 'Free'            }
  ];

  returnPolicies = [
    { value: '30-days',    label: '30 Days'    },
    { value: '14-days',    label: '14 Days'    },
    { value: 'no-returns', label: 'No Returns' },
    { value: 'custom',     label: 'Custom'     }
  ];

  itemConditions = [
    'New', 'Used - Excellent', 'Used - Very Good', 'Used - Good',
    'Used - Fair', 'For Parts or Not Working'
  ];

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.router.navigate(['/dashboard']); return; }
    this.loadListing(id);
  }

  async loadListing(id: string): Promise<void> {
    try {
      this.listing = await firstValueFrom(this.listingsService.getListingById(id));
      this.determineEditMode();
      this.buildForm();
      this.existingImageUrls = [...(this.listing.images || [])];
    } catch {
      this.errorMessage = 'Failed to load listing.';
    } finally {
      this.isLoading = false;
    }
  }

  determineEditMode(): void {
    if (!this.listing) return;
    if (this.listing.status === 'draft') {
      this.editMode = 'full';
    } else if (this.listing.status === 'active' && this.listing.bidCount === 0) {
      this.editMode = 'partial';
    } else {
      this.editMode = 'locked';
    }
  }

  buildForm(): void {
    const l = this.listing!;
    this.editForm = this.fb.group({
      // Critical fields — always present but disabled when not in full mode
      title:       [{ value: l.title,    disabled: this.editMode !== 'full' }, [Validators.required, Validators.maxLength(80)]],
      titlePt:     [{ value: l.titlePt || l.title || '', disabled: this.editMode !== 'full' }, [Validators.required, Validators.maxLength(80)]],
      titleEn:     [{ value: l.titleEn || '', disabled: this.editMode === 'locked' }, [Validators.maxLength(80)]],
      category:    [{ value: l.category, disabled: this.editMode !== 'full' }, Validators.required],
      subCategory: [{ value: l.subCategory || '', disabled: this.editMode !== 'full' }],

      // Editable in partial + full
      description: [{ value: l.description, disabled: this.editMode === 'locked' }, [Validators.required, Validators.minLength(50)]],
      descriptionPt: [{ value: l.descriptionPt || l.description || '', disabled: this.editMode === 'locked' }, [Validators.required, Validators.minLength(50)]],
      descriptionEn: [{ value: l.descriptionEn || '', disabled: this.editMode === 'locked' }],
      condition:   [{ value: l.condition,   disabled: this.editMode === 'locked' }, Validators.required],

      locationCity:    [{ value: l.locationCity    || '', disabled: this.editMode === 'locked' }],
      locationCountry: [{ value: l.locationCountry || 'PT', disabled: this.editMode === 'locked' }],

      shippingOption: [{ value: l.shippingOption || 'flat-rate', disabled: this.editMode === 'locked' }, Validators.required],
      shippingCost:   [{ value: l.shippingCost   ?? 0,          disabled: this.editMode === 'locked' }],
      returnPolicy:   [{ value: l.returnPolicy   || '',         disabled: this.editMode === 'locked' }, Validators.required],
      handlingTime:   [{ value: l.handlingTime   ?? 5,          disabled: this.editMode === 'locked' }],

      specifications: this.fb.array(
        (l.specifications as any[] || []).map((s: any) => this.fb.group({
          key:   [{ value: s.key,   disabled: this.editMode === 'locked' }, Validators.required],
          value: [{ value: s.value, disabled: this.editMode === 'locked' }, Validators.required]
        }))
      )
    });
  }

  get specifications(): FormArray {
    return this.editForm.get('specifications') as FormArray;
  }

  addSpecification(): void {
    this.specifications.push(this.fb.group({
      key:   ['', Validators.required],
      value: ['', Validators.required]
    }));
  }

  removeSpecification(i: number): void {
    this.specifications.removeAt(i);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.addFiles(input.files);
    input.value = '';
  }

  private readonly ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

  private addFiles(fileList: FileList): void {
    Array.from(fileList).forEach(file => {
      if (!this.ALLOWED_TYPES.includes(file.type)) return;
      this.uploadedFiles.push(file);
      const reader = new FileReader();
      reader.onload = e => this.previewUrls.push(e.target?.result || null);
      reader.readAsDataURL(file);
    });
  }

  removeNewFile(i: number): void {
    this.uploadedFiles.splice(i, 1);
    this.previewUrls.splice(i, 1);
  }

  removeExistingImage(i: number): void {
    this.existingImageUrls.splice(i, 1);
  }

  async uploadNewImages(): Promise<string[]> {
    if (this.uploadedFiles.length === 0) return [];
    this.isUploadingImages = true;
    try {
      const formData = new FormData();
      this.uploadedFiles.forEach(f => formData.append('images', f));
      const res = await firstValueFrom(
        this.http.post<{ urls: string[] }>(`${API_CONFIG.getApiUrl()}/uploads`, formData)
      );
      return res.urls || [];
    } catch (error: any) {
      const isContentViolation = error?.error?.error === 'Content policy violation';
      const msg = error?.error?.message || error?.message || 'Failed to upload images. Please try again.';
      throw Object.assign(new Error(msg), { isContentViolation });
    } finally {
      this.isUploadingImages = false;
    }
  }

  async onSubmit(): Promise<void> {
    if (this.editMode === 'locked' || this.isSubmitting) return;
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      this.errorMessage = 'Please fix the highlighted errors before saving.';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';

    try {
      const newImageUrls = await this.uploadNewImages();
      const allImages = [...this.existingImageUrls, ...newImageUrls];

      const raw = this.editForm.getRawValue();
      const payload: any = {
        description:     raw.descriptionPt || raw.description,
        descriptionPt:   raw.descriptionPt,
        descriptionEn:   raw.descriptionEn,
        condition:       raw.condition,
        locationCity:    raw.locationCity,
        locationCountry: raw.locationCountry,
        shippingOption:  raw.shippingOption,
        shippingCost:    raw.shippingCost,
        returnPolicy:    raw.returnPolicy,
        handlingTime:    raw.handlingTime,
        specifications:  raw.specifications,
        images:          allImages
      };

      payload.titleEn = raw.titleEn;

      if (this.editMode === 'full') {
        payload.title       = raw.titlePt || raw.title;
        payload.titlePt     = raw.titlePt;
        payload.category    = raw.category;
        payload.subCategory = raw.subCategory;
      }

      const result = await firstValueFrom(this.listingsService.updateListing(this.listing!._id, payload));

      if (result.contentWarning) {
        await Swal.fire({
          icon: 'warning',
          title: 'Content notice',
          text: result.contentWarning.message,
          confirmButtonText: 'View listing',
          confirmButtonColor: '#2563eb'
        });
      } else {
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Listing updated', showConfirmButton: false, timer: 2500 });
      }
      this.router.navigate(['/listing', this.listing!.slug]);
    } catch (err: any) {
      // Image blocked by content moderation — show a prominent modal
      if (err?.isContentViolation) {
        Swal.fire({
          icon: 'error',
          title: 'Image Not Allowed',
          html: `<p>${err.message}</p>
                 <p style="font-size:0.82em;margin-top:0.75em;color:#6b7280">
                   Remove or replace the flagged image(s) and try again.
                   Repeated violations may lead to account restrictions.
                 </p>`,
          confirmButtonText: 'OK',
          confirmButtonColor: '#dc2626'
        });
        this.errorMessage = '';
      } else {
        this.errorMessage = err.error?.message || err.message || 'Failed to update listing.';
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  get editModeLabel(): string {
    if (this.editMode === 'full')    return 'Full editing available (draft)';
    if (this.editMode === 'partial') return 'Limited editing — listing is live with no bids';
    return 'Editing locked — bids have been placed';
  }
}
