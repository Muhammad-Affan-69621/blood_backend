import { NotificationsModule } from '../notifications/notifications.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DonorResponsesController } from './donor-responses.controller';
import { DonorResponsesService } from './donor-responses.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [NotificationsModule, AuthModule, PrismaModule],
  controllers: [DonorResponsesController],
  providers: [DonorResponsesService],
  exports: [DonorResponsesService],
})
export class DonorResponsesModule {}

