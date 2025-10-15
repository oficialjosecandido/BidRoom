import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '@shared/shared.module';

// Components (placeholders)
const routes: Routes = [
  {
    path: '',
    children: [
      // Dashboard routes will be added
    ],
  },
];

@NgModule({
  declarations: [],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class DashboardModule {}

