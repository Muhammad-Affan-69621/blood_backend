import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,

  Query,} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateOrganizationDto } from './organization.dto';
import {
  InviteOrganizationMemberDto,
  UpdateMembershipRoleDto,
  UpdateMembershipStatusDto,
} from './organization-membership.dto';
import { OrganizationsService } from './organizations.service';

interface AuthenticatedRequest extends Request {
  user: {
    sub: string;
    email: string;
    roles: string[];
  };
}

@ApiTags('Organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'List organizations, optionally filtered by status' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  listActive(
    @Req() request: AuthenticatedRequest,
    @Query('status') status?: string,
  ) {
    return this.organizationsService.listByStatus(request.user.sub, status);
  }

  @Patch(':id/restore')
  @ApiOperation({
    summary: 'Restore an archived organization (active platform administrators only)',
  })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  restore(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.organizationsService.restore(request.user.sub, id);
  }


  @Delete(':id')
  @ApiOperation({
    summary: 'Archive an organization (active platform administrators only)',
  })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  archive(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.organizationsService.archive(request.user.sub, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an active organization by ID' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getById(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.organizationsService.getById(request.user.sub, id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create an organization and become its administrator',
  })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateOrganizationDto) {
    return this.organizationsService.create(request.user.sub, dto);
  }

  @Get(':id/members')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List organization members (active administrators only)',
  })
  listMembers(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) organizationId: string,
  ) {
    return this.organizationsService.listMembers(request.user.sub, organizationId);
  }

  @Post(':id/members')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Invite an existing active user to an organization',
  })
  inviteMember(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) organizationId: string,
    @Body() dto: InviteOrganizationMemberDto,
  ) {
    return this.organizationsService.inviteMember(request.user.sub, organizationId, dto);
  }

  @Patch(':id/members/:membershipId/role')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update an organization membership role',
  })
  updateMembershipRole(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) organizationId: string,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body() dto: UpdateMembershipRoleDto,
  ) {
    return this.organizationsService.updateMembershipRole(
      request.user.sub,
      organizationId,
      membershipId,
      dto,
    );
  }

  @Patch(':id/members/:membershipId/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update an organization membership status',
  })
  updateMembershipStatus(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) organizationId: string,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Body() dto: UpdateMembershipStatusDto,
  ) {
    return this.organizationsService.updateMembershipStatus(
      request.user.sub,
      organizationId,
      membershipId,
      dto,
    );
  }
  @Post(':id/members/:membershipId/accept')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Accept your own pending organization invitation',
  })
  acceptInvitation(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) organizationId: string,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
  ) {
    return this.organizationsService.acceptInvitation(
      request.user.sub,
      organizationId,
      membershipId,
    );
  }
}





