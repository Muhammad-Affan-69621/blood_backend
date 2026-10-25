import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { ForgotPasswordDto, LoginDto, RefreshTokenDto, RegisterDto, ResetPasswordDto } from './auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'If an account exists for this email, password-reset instructions will be sent.' })
  @ApiBadRequestResponse({ description: 'Invalid email input.' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Password reset completed.' })
  @ApiBadRequestResponse({ description: 'Invalid reset input.' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  @ApiCreatedResponse({ description: 'Account created.' })
  @ApiBadRequestResponse({ description: 'Invalid registration input.' })
  @ApiConflictResponse({ description: 'Email is already registered.' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Login successful.' })
  @ApiBadRequestResponse({ description: 'Invalid login input.' })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials or unavailable account.',
  })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Refresh token rotated successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid refresh-token input.' })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token.' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Refresh token revoked if it was active.' })
  @ApiBadRequestResponse({ description: 'Invalid refresh-token input.' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getMe(
    @Req()
    request: Request & {
      user?: {
        sub: string;
        email: string;
        roles: string[];
      };
    },
  ) {
    return { user: request.user };
  }
}

