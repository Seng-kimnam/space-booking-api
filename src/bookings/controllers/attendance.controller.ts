import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentAuthUser } from '../../common/decorators/current-auth-user.decorator';
import { Secured } from '../../common/decorators/secured.decorator';
import { QrPurpose } from '../../common/enums';
import { UserRole } from '../../common/enums';
import type { AuthUser } from '../../common/types/auth-user';
import { ScanQrDto } from '../dto/booking-request.dto';
import { AttendanceResponseDto } from '../dto/booking-response.dto';
import { AttendanceService } from '../services/attendance.service';

@ApiTags('Check-in & Check-out')
@ApiBearerAuth()
@Secured(UserRole.USER, UserRole.ADMIN)
@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('check-in/scan')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check in by scanning a one-time QR' })
  @ApiOkResponse({ type: AttendanceResponseDto })
  @ApiBadRequestResponse({ description: 'QR invalid, used or expired' })
  @ApiConflictResponse({ description: 'Outside the check-in window, or wrong status' })
  @ApiForbiddenResponse({ description: "Another user's QR (only staff may scan those)" })
  checkIn(@CurrentAuthUser() user: AuthUser, @Body() dto: ScanQrDto): Promise<AttendanceResponseDto> {
    return this.attendance.scan(user, dto.qr, QrPurpose.CHECK_IN);
  }

  @Post('check-out/scan')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check out by scanning a one-time QR (also closes a forgotten checkout)' })
  @ApiOkResponse({ type: AttendanceResponseDto })
  @ApiBadRequestResponse({ description: 'QR invalid, used or expired' })
  checkOut(@CurrentAuthUser() user: AuthUser, @Body() dto: ScanQrDto): Promise<AttendanceResponseDto> {
    return this.attendance.scan(user, dto.qr, QrPurpose.CHECK_OUT);
  }
}
