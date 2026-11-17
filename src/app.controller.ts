import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

export interface HealthResponse {
  status: 'ok';
  message: string;
  timestamp: string;
  uptime: number;
}

@ApiTags('Health')
@Controller()
export class AppController {
  @Get('health/check')
  @ApiOkResponse({ description: 'The API is up and running.' })
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      message: 'Space Booking API is running successfully',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    };
  }
}
