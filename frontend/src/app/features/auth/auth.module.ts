import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '@shared/shared.module';

// Components (placeholders)
const routes: Routes = [
  {
    path: 'callback',
    children: [],
  },
];

@NgModule({
  declarations: [],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class AuthModule {}

