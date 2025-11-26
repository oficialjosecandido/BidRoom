import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddListing } from './add-listing';

describe('AddListing', () => {
  let component: AddListing;
  let fixture: ComponentFixture<AddListing>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddListing]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AddListing);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
