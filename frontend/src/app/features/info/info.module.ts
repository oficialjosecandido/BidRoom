import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '@shared/shared.module';
import { HowItWorksComponent } from './how-it-works/how-it-works.component';
import { FaqComponent } from './faq/faq.component';
import { ContactComponent } from './contact/contact.component';

const routes: Routes = [
  {
    path: 'how-it-works',
    component: HowItWorksComponent,
  },
  {
    path: 'faq',
    component: FaqComponent,
  },
  {
    path: 'contact',
    component: ContactComponent,
  },
  {
    path: '',
    redirectTo: 'how-it-works',
    pathMatch: 'full',
  },
];

@NgModule({
  declarations: [
    HowItWorksComponent,
    FaqComponent,
    ContactComponent,
  ],
  imports: [
    SharedModule,
    FormsModule,
    RouterModule.forChild(routes),
  ],
})
export class InfoModule {}
