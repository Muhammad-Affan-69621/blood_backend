import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DonorProfileController } from './donor-profile.controller';
import { DonorsController } from './donors.controller';
import { DonorProfileService } from './donor-profile.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [DonorProfileController, DonorsController],
  providers: [DonorProfileService],
  exports: [DonorProfileService],
})
export class DonorProfileModule {}