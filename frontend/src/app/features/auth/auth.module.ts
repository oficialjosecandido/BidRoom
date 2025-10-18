import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { SharedModule } from '@shared/shared.module';

// Components
import { LoginComponent } from './login/login.component';
import { RegisterComponent } from './register/register.component';
import { CallbackComponent } from './callback/callback.component';
import { VerifyBiddingComponent } from './verify-bidding/verify-bidding.component';
import { PreAuthComponent } from './pre-auth/pre-auth.component';
import { EmailConfirmationComponent } from './email-confirmation/email-confirmation.component';

const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
  },
  {
    path: 'register',
    component: RegisterComponent,
  },
  {
    path: 'callback',
    component: CallbackComponent,
  },
  {
    path: 'verify-bidding',
    component: VerifyBiddingComponent,
  },
  {
    path: 'pre-auth',
    component: PreAuthComponent,
  },
  {
    path: 'confirm-email',
    component: EmailConfirmationComponent,
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
];

@NgModule({
  declarations: [
    LoginComponent,
    RegisterComponent,
    CallbackComponent,
    VerifyBiddingComponent,
    PreAuthComponent,
    EmailConfirmationComponent,
  ],
  imports: [
    CommonModule,
    SharedModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule.forChild(routes),
  ],
})
export class AuthModule {}