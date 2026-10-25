import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateUserDto } from './update-user.dto';
import { UsersService } from './users.service';

interface AuthenticatedRequest extends Request {
  user: {
    sub: string;
    email: string;
    roles: string[];
  };
}

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the logged-in account details' })
  @ApiOkResponse({ description: 'Account details retrieved.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiNotFoundResponse({ description: 'Account not found.' })
  getMe(@Req() request: AuthenticatedRequest) {
    return this.usersService.getMe(request.user.sub);
  }

  @Get('me/memberships')
  @ApiOperation({ summary: 'Get the logged-in user organization memberships and invitations' })
  @ApiOkResponse({ description: 'Memberships and invitations retrieved.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  getMyMemberships(@Req() request: AuthenticatedRequest) {
    return this.usersService.getMyMemberships(request.user.sub);
  }
  @Patch('me')
  @ApiOperation({ summary: 'Update the logged-in account email' })
  @ApiOkResponse({ description: 'Account updated.' })
  @ApiBadRequestResponse({ description: 'Invalid email address.' })
  @ApiConflictResponse({ description: 'Email address already in use.' })
  updateMe(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateMe(request.user.sub, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate the logged-in account' })
  @ApiOkResponse({ description: 'Account deactivated and refresh tokens revoked.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
  @ApiNotFoundResponse({ description: 'Account not found.' })
  deactivateMe(@Req() request: AuthenticatedRequest) {
    return this.usersService.deactivateMe(request.user.sub);
  }
}

