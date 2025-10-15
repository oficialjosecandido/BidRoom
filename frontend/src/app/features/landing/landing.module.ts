import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '@shared/shared.module';
import { LandingComponent } from './landing.component';

const routes: Routes = [
  {
    path: '',
    component: LandingComponent,
  },
];

@NgModule({
  declarations: [LandingComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class LandingModule {}

