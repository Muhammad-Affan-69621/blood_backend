import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @ApiOperation({ summary: 'Check whether the API process is alive' })
  @ApiResponse({ status: 200, description: 'API process is alive.' })
  live() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check whether the API can serve requests' })
  @ApiResponse({ status: 200, description: 'API and database are ready.' })
  @ApiResponse({ status: 503, description: 'Database is unavailable.' })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'disconnected',
        message: 'Database health check failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  @Get()
  @ApiOperation({ summary: 'Check API and database health' })
  async check() {
    return this.ready();
  }
}
