import {
  Body,
  Controller,
  Headers,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateBloodRequestDto } from './blood-requests.dto';
import { ListMyBloodRequestsDto } from './dto/list-my-blood-requests.dto';
import { BloodRequestsService } from './blood-requests.service';
import { UpdateBloodRequestStatusDto } from './dto/update-blood-request-status.dto';
import { UpdateBloodRequestDto } from './dto/update-blood-request.dto';
import { CancelBloodRequestDto } from './dto/cancel-blood-request.dto';

interface AuthenticatedRequest {
  user: {
    sub: string;
    email: string;
    roles: string[];
  };
}

@ApiTags('Blood Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('blood-requests')
export class BloodRequestsController {
  constructor(private readonly bloodRequestsService: BloodRequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a blood request' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Optional retry-safe request key (max 128 characters).',
  })
  create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateBloodRequestDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.bloodRequestsService.create(req.user.sub, dto, idempotencyKey);
  }
  @Get('me')
  @ApiOperation({ summary: 'List my blood requests' })
  findMine(@Req() req: AuthenticatedRequest, @Query() query: ListMyBloodRequestsDto) {
    return this.bloodRequestsService.findMine(req.user.sub, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of my blood requests' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.bloodRequestsService.findOne(req.user.sub, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit your open blood request' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBloodRequestDto,
  ) {
    return this.bloodRequestsService.update(req.user.sub, id, dto);
  }
  @Patch(':id/status')
  @ApiOperation({
    summary: 'Update the status of your blood request',
  })
  updateStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBloodRequestStatusDto,
  ) {
    return this.bloodRequestsService.updateStatus(req.user.sub, id, dto);
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary: 'Cancel your blood request',
  })
  cancelRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelBloodRequestDto,
  ) {
    return this.bloodRequestsService.cancelRequest(req.user.sub, id, dto.reason);
  }
}
