import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateDonorResponseDto } from './dto/create-donor-response.dto';
import { ListDonorRequestsDto } from './dto/list-donor-requests.dto';
import { DonorResponsesService } from './donor-responses.service';
import { RecipientResponseDecisionDto } from './dto/recipient-response-decision.dto';

interface AuthenticatedRequest {
  user: {
    sub: string;
    email: string;
    roles: string[];
  };
}

@ApiTags('Donor Responses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('donor-responses')
export class DonorResponsesController {
  constructor(private readonly donorResponsesService: DonorResponsesService) {}

  @Get('requests')
  @ApiOperation({ summary: 'List open blood requests compatible with the current donor' })
  findOpenRequestsForDonor(@Req() req: AuthenticatedRequest, @Query() query: ListDonorRequestsDto) {
    return this.donorResponsesService.findOpenRequestsForDonor(req.user.sub, query);
  }

  @Get('me')
  @ApiOperation({ summary: 'List responses submitted by the current donor' })
  findMine(@Req() req: AuthenticatedRequest) {
    return this.donorResponsesService.findMine(req.user.sub);
  }

  @Post('requests/:requestId')
  @ApiOperation({ summary: 'Submit a response to a blood request as a donor' })
  create(
    @Req() req: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: CreateDonorResponseDto,
  ) {
    return this.donorResponsesService.create(req.user.sub, requestId, dto);
  }

  @Get('requests/:requestId')
  @ApiOperation({ summary: 'View responses to your blood request as a recipient' })
  findForRecipient(
    @Req() req: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.donorResponsesService.findForRecipient(req.user.sub, requestId);
  }

  @Post('requests/:requestId/responses/:responseId/decision')
  @ApiOperation({
    summary: 'Accept or reject a donor response as the recipient',
  })
  decideForRecipient(
    @Req() req: AuthenticatedRequest,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Param('responseId', ParseUUIDPipe) responseId: string,
    @Body() dto: RecipientResponseDecisionDto,
  ) {
    return this.donorResponsesService.decideForRecipient(
      req.user.sub,
      requestId,
      responseId,
      dto.decision,
    );
  }
}
