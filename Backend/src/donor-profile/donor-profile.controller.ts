import { Body, Controller, Get, Patch, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  SearchDonorsDto,
  UpdateDonorAvailabilityDto,
  UpsertDonorProfileDto,
} from './donor-profile.dto';
import { DonorProfileService } from './donor-profile.service';

interface AuthenticatedRequest extends Request {
  user: {
    sub: string;
    email: string;
    roles: string[];
  };
}

@ApiTags('Donor Profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('donor-profile')
export class DonorProfileController {
  constructor(private readonly donorProfileService: DonorProfileService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search available, verified donors by blood group and city' })
  @ApiQuery({ name: 'bloodGroup', required: false, enum: ['O_NEGATIVE', 'O_POSITIVE', 'A_NEGATIVE', 'A_POSITIVE', 'B_NEGATIVE', 'B_POSITIVE', 'AB_NEGATIVE', 'AB_POSITIVE'] })
  @ApiQuery({ name: 'city', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  searchDonors(@Req() request: AuthenticatedRequest, @Query() query: SearchDonorsDto) {
    return this.donorProfileService.searchDonors(request.user.sub, query);
  }
  @Get('me')
  @ApiOperation({ summary: 'Get the logged-in donor profile' })
  getMyProfile(@Req() request: AuthenticatedRequest) {
    return this.donorProfileService.getMyProfile(request.user.sub);
  }

  @Patch('me/availability')
  @ApiOperation({ summary: 'Update the logged-in donor availability' })
  updateMyAvailability(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateDonorAvailabilityDto,
  ) {
    return this.donorProfileService.updateMyAvailability(request.user.sub, dto.isAvailable);
  }

  @Put('me')
  @ApiOperation({ summary: 'Create or update the logged-in donor profile' })
  upsertMyProfile(@Req() request: AuthenticatedRequest, @Body() dto: UpsertDonorProfileDto) {
    return this.donorProfileService.upsertMyProfile(request.user.sub, dto);
  }
}




