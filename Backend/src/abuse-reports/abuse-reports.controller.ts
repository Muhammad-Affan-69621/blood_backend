import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AbuseReportStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateAbuseReportDto, ReviewAbuseReportDto } from './abuse-reports.dto';
import { AbuseReportsService } from './abuse-reports.service';

type AuthenticatedRequest = Request & { user: { sub: string } };

@ApiTags('Abuse Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('abuse-reports')
export class AbuseReportsController {
  constructor(private readonly service: AbuseReportsService) {}

  @Post(':targetId')
  @ApiOperation({ summary: 'Report a user, blood request, or organization' })
  create(
    @Req() req: AuthenticatedRequest,
    @Param('targetId', new ParseUUIDPipe()) targetId: string,
    @Body() dto: CreateAbuseReportDto,
  ) {
    return this.service.create(req.user.sub, targetId, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: 'List reports submitted by the current user' })
  listMine(@Req() req: AuthenticatedRequest) {
    return this.service.listMine(req.user.sub);
  }

  @Get('moderation/queue')
  @ApiOperation({ summary: 'List open reports (moderator or platform administrator)' })
  listQueue(
    @Req() req: AuthenticatedRequest,
    @Query('status', new ParseEnumPipe(AbuseReportStatus, { optional: true }))
    status?: AbuseReportStatus,
  ) {
    return this.service.listQueue(req.user.sub, status);
  }

  @Patch('moderation/:reportId')
  @ApiOperation({ summary: 'Review or close a report (moderator or platform administrator)' })
  review(
    @Req() req: AuthenticatedRequest,
    @Param('reportId', new ParseUUIDPipe()) reportId: string,
    @Body() dto: ReviewAbuseReportDto,
  ) {
    return this.service.review(req.user.sub, reportId, dto);
  }
}
