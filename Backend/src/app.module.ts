import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminModule } from './admin/admin.module';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsModule } from './notifications/notifications.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { AbuseReportsModule } from './abuse-reports/abuse-reports.module';
import { VerificationModule } from './verification/verification.module';

import { validateEnvironment } from './config/env.validation';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { DonorProfileModule } from './donor-profile/donor-profile.module';
import { BloodRequestsModule } from './blood-requests/blood-requests.module';
import { DonorMatchingModule } from './donor-matching/donor-matching.module';
import { DonorResponsesModule } from './donor-responses/donor-responses.module';
import { ConsentsModule } from './consents/consents.module';
import { UsersModule } from './users/users.module';
import { PushSubscriptionsModule } from './push-subscriptions/push-subscriptions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/api/.env'],
      cache: true,
      expandVariables: false,
      validate: validateEnvironment,
    }),

    ScheduleModule.forRoot(),

    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),

    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    PushSubscriptionsModule,
    DonorProfileModule,
    BloodRequestsModule,
    DonorMatchingModule,
    DonorResponsesModule,
    NotificationsModule,
    OrganizationsModule,
    AbuseReportsModule,
    ConsentsModule,
    VerificationModule,
    AdminModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
