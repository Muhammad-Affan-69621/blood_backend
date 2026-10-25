import { NotificationsModule } from '../notifications/notifications.module';
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BloodRequestsController } from './blood-requests.controller';
import { BloodRequestsService } from './blood-requests.service';
import { RequestExpirationService } from './request-expiration.service';

@Module({
  imports: [NotificationsModule, AuthModule],
  controllers: [BloodRequestsController],
  providers: [BloodRequestsService, RequestExpirationService],
})
export class BloodRequestsModule {}

