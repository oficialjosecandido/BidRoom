import { Routes } from '@angular/router';
import { AuthGuard } from '../auth/guards/auth.guard';

export const privateRoomRoutes: Routes = [
  {
    path: 'listings/:id/platinum-bidders',
    loadComponent: () => import('./components/platinum-bidders/platinum-bidders.component').then(m => m.PlatinumBiddersComponent),
    canActivate: [AuthGuard]
  },
  {
    path: 'auction/:id',
    loadComponent: () => import('./components/private-room-auction/private-room-auction.component').then(m => m.PrivateRoomAuctionComponent)
  },
  {
    path: 'invitation/accept',
    loadComponent: () => import('./components/invitation-accept/invitation-accept.component').then(m => m.InvitationAcceptComponent)
  },
  {
    path: 'invitation/decline',
    loadComponent: () => import('./components/invitation-accept/invitation-accept.component').then(m => m.InvitationAcceptComponent)
  }
];

