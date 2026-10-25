import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ReviewVerificationDto,
  SubmitVerificationDto,
  VerificationQueueQueryDto,
} from './verification.dto';
import { VerificationService } from './verification.service';

interface AuthenticatedRequest extends Request {
  user: {
    sub: string;
  };
}

@ApiTags('verification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('me/submit')
  @ApiOperation({ summary: 'Submit donor profile for verification' })
  submit(@Req() req: AuthenticatedRequest, @Body() dto: SubmitVerificationDto) {
    return this.verificationService.submit(req.user.sub, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get own donor verification status' })
  getMyStatus(@Req() req: AuthenticatedRequest) {
    return this.verificationService.getMyStatus(req.user.sub);
  }

  @Get('queue')
  @ApiOperation({ summary: 'List pending donor verification reviews' })
  getQueue(@Req() req: AuthenticatedRequest, @Query() query: VerificationQueueQueryDto) {
    return this.verificationService.getQueue(req.user.sub, query.limit, query.cursor);
  }

  @Patch(':donorId/review')
  @ApiOperation({ summary: 'Approve, reject, or suspend donor verification' })
  review(
    @Req() req: AuthenticatedRequest,
    @Param('donorId') donorId: string,
    @Body() dto: ReviewVerificationDto,
  ) {
    return this.verificationService.review(req.user.sub, donorId, dto);
  }
}
