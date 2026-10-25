import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DonorMatchingController } from './donor-matching.controller';
import { DonorMatchingService } from './donor-matching.service';

@Module({
  imports: [AuthModule],
  controllers: [DonorMatchingController],
  providers: [DonorMatchingService],
})
export class DonorMatchingModule {}
