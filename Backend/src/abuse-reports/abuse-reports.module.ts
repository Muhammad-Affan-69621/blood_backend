import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AbuseReportsController } from './abuse-reports.controller';
import { AbuseReportsService } from './abuse-reports.service';

@Module({
  imports: [AuthModule],
  controllers: [AbuseReportsController],
  providers: [AbuseReportsService],
})
export class AbuseReportsModule {}
