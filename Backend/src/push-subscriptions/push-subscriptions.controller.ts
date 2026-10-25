import {
  Body,
  Controller,
  Delete,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RegisterPushSubscriptionDto } from './dto/register-push-subscription.dto';
import { RevokePushSubscriptionDto } from './dto/revoke-push-subscription.dto';
import { PushSubscriptionsService } from './push-subscriptions.service';

interface AuthenticatedRequest {
  user: { sub: string };
}

@ApiTags('Push subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('push-subscriptions')
export class PushSubscriptionsController {
  constructor(private readonly service: PushSubscriptionsService) {}

  @Post()
  @ApiOperation({ summary: 'Register or refresh my push subscription' })
  register(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RegisterPushSubscriptionDto,
  ) {
    return this.service.register(req.user.sub, dto);
  }

  @Delete()
  @ApiOperation({ summary: 'Revoke my push subscription by endpoint' })
  revoke(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RevokePushSubscriptionDto,
  ) {
    return this.service.revoke(req.user.sub, dto.endpoint);
  }
}