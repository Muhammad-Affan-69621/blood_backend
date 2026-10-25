
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DonorProfileService } from './donor-profile.service';

@ApiTags('Donors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('donors')
export class DonorsController {
  constructor(
    private readonly donorProfileService: DonorProfileService,
  ) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Get privacy-filtered public details for an eligible donor',
  })
  getDonorById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.donorProfileService.getPublicDonorById(id);
  }
}
