import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminService } from './admin.service';

interface AuthenticatedRequest {
  user: {
    sub: string;
    email: string;
    roles: string[];
  };
}

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Get platform-wide administrative dashboard statistics',
  })
  getStats(@Req() req: AuthenticatedRequest) {
    return this.adminService.getStats(req.user.sub);
  }
}
