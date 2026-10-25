import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DonorMatchingService } from './donor-matching.service';

interface AuthenticatedRequest {
  user: {
    sub: string;
    email: string;
    roles: string[];
  };
}

@ApiTags('Donor Matching')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('blood-requests')
export class DonorMatchingController {
  constructor(private readonly donorMatchingService: DonorMatchingService) {}

  @Get(':id/matches')
  @ApiOperation({
    summary: 'Find compatible donors for an open blood request',
  })
  @ApiQuery({
    name: 'radiusKm',
    required: false,
    type: Number,
    description: 'Search radius in kilometers (maximum configured by the server)',
  })
  findMatches(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('radiusKm') radiusKm?: string,
  ) {
    let parsedRadius: number | undefined;

    if (radiusKm !== undefined) {
      parsedRadius = Number(radiusKm);

      if (radiusKm.trim() === '' || !Number.isFinite(parsedRadius)) {
        throw new BadRequestException('radiusKm must be a valid number.');
      }
    }

    return this.donorMatchingService.findMatches(req.user.sub, id, parsedRadius);
  }
}
