import { NgModule, Optional, SkipSelf } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';

// Services
import { AuthService } from './services/auth.service';
import { AuctionService } from './services/auction.service';
import { BidService } from './services/bid.service';
import { UserService } from './services/user.service';
import { SocketService } from './services/socket.service';
import { NotificationService } from './services/notification.service';

@NgModule({
  imports: [CommonModule, HttpClientModule],
  providers: [
    AuthService,
    AuctionService,
    BidService,
    UserService,
    SocketService,
    NotificationService,
  ],
})
export class CoreModule {
  constructor(@Optional() @SkipSelf() parentModule: CoreModule) {
    if (parentModule) {
      throw new Error('CoreModule is already loaded. Import it in the AppModule only');
    }
  }
}

