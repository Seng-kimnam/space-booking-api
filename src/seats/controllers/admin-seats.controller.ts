import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { Roles } from '../../auth/decorators/role.decorator';
import { RolesInterceptor } from '../../auth/interceptors/roles.interceptor';
import { UserRole } from '../../common/enums';
import { SeatsService } from '../services/seats.service';
import { CreateSeatDto } from '../dto/create-seat.dto';
import { UpdateSeatDto } from '../dto/update-seat.dto';
import { UpdateSeatStatusDto } from '../dto/update-seat-status.dto';
import { SeatResponseDto, toSeatResponse } from '../dto/seat.response.dto';

@ApiTags('Seats')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@UseGuards(AuthGuard)
@UseInterceptors(RolesInterceptor)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminSeatsController {
  constructor(private readonly seats: SeatsService) {}

  @Post('places/:placeId/seats')
  @ApiOperation({ summary: 'Create a seat in a place' })
  @ApiCreatedResponse({ type: SeatResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Label already used in this place' })
  async create(
    @Param('placeId', ParseUUIDPipe) placeId: string,
    @Body() dto: CreateSeatDto,
  ) {
    return toSeatResponse(await this.seats.create(placeId, dto));
  }

  @Patch('seats/:seatId')
  @ApiOperation({ summary: 'Update seat label, area or features' })
  @ApiOkResponse({ type: SeatResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Label already used in this place' })
  async update(
    @Param('seatId', ParseUUIDPipe) seatId: string,
    @Body() dto: UpdateSeatDto,
  ) {
    return toSeatResponse(await this.seats.update(seatId, dto));
  }

  @Patch('seats/:seatId/status')
  @ApiOperation({ summary: 'Set seat status' })
  @ApiOkResponse({ type: SeatResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  async setStatus(
    @Param('seatId', ParseUUIDPipe) seatId: string,
    @Body() dto: UpdateSeatStatusDto,
  ) {
    return toSeatResponse(await this.seats.setStatus(seatId, dto.status));
  }

  @Delete('seats/:seatId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a seat' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Seat still has active bookings' })
  softDelete(@Param('seatId', ParseUUIDPipe) seatId: string) {
    return this.seats.softDelete(seatId);
  }
}
