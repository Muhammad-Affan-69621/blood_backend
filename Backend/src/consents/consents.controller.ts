import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GrantConsentDto } from './dto/grant-consent.dto';
import { UpdateContactPreferenceDto } from './dto/update-contact-preference.dto';
import { UpdateUrgentNotificationsDto } from './dto/update-urgent-notifications.dto';
import { ConsentsService } from './consents.service';

interface AuthenticatedRequest {
  user: { sub: string; email: string; roles: string[] };
}

@ApiTags('Consents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('consents')
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  @Get('me')
  @ApiOperation({ summary: 'View my contact-sharing preference and consent history' })
  findMine(@Req() req: AuthenticatedRequest) {
    return this.consentsService.findMine(req.user.sub);
  }

  @Post('me')
  @ApiOperation({ summary: 'Grant contact-sharing consent as a donor' })
  grant(@Req() req: AuthenticatedRequest, @Body() dto: GrantConsentDto) {
    return this.consentsService.grant(req.user.sub, dto);
  }

  @Post('me/:id/revoke')
  @ApiOperation({ summary: 'Revoke one of my active consents' })
  revoke(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.consentsService.revoke(req.user.sub, id);
  }

  @Get('requests/:requestId/donors/:donorId/contact')
  @ApiOperation({
    summary:
      'Get a donor email when request ownership, acceptance, preference, and consent allow disclosure',
  })
  getAuthorizedContact(
    @Req() req: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Param('donorId', ParseUUIDPipe) donorId: string,
  ) {
    return this.consentsService.getAuthorizedContact(req.user.sub, requestId, donorId);
  }

  @Put('me/urgent-notifications')
  @ApiOperation({ summary: 'Update my urgent blood-request notification opt-in' })
  updateUrgentNotificationsPreference(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateUrgentNotificationsDto,
  ) {
    return this.consentsService.updateUrgentNotificationsPreference(req.user.sub, dto);
  }

  @Put('me/preferences')
  @ApiOperation({ summary: 'Update my contact-sharing preference' })
  updatePreference(@Req() req: AuthenticatedRequest, @Body() dto: UpdateContactPreferenceDto) {
    return this.consentsService.updatePreference(req.user.sub, dto);
  }
}
