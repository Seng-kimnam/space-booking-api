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
  UsePipes,
  ValidationPipe,
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
import { AuthGuard } from '../../auth/auth.guard';
import { Roles } from '../../auth/role.decorator';
import { RolesInterceptor } from '../../auth/roles.interceptor';
import { UserRole } from '../../users/entities/user.entity';
import {
  AreaResponseDto,
  CreateAreaDto,
  toAreaResponse,
  UpdateAreaDto,
} from '../dto/area.dto';
import { AreasService } from '../services/areas.service';

// Per-controller pipe because there is no global one yet; drop it when one is added.
@ApiTags('Areas')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@UseGuards(AuthGuard)
@UseInterceptors(RolesInterceptor)
@Roles(UserRole.ADMIN)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller('admin')
export class AdminAreasController {
  constructor(private readonly areas: AreasService) {}

  @Post('places/:placeId/areas')
  @ApiOperation({ summary: 'Create an area in a place' })
  @ApiCreatedResponse({ type: AreaResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Name already used in this place' })
  async create(
    @Param('placeId', ParseUUIDPipe) placeId: string,
    @Body() dto: CreateAreaDto,
  ) {
    return toAreaResponse(await this.areas.create(placeId, dto));
  }

  @Patch('areas/:areaId')
  @ApiOperation({ summary: 'Update an area' })
  @ApiOkResponse({ type: AreaResponseDto })
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Name already used in this place' })
  async update(
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Body() dto: UpdateAreaDto,
  ) {
    return toAreaResponse(await this.areas.update(areaId, dto));
  }

  @Delete('areas/:areaId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete an area' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Seats are still assigned to the area' })
  softDelete(@Param('areaId', ParseUUIDPipe) areaId: string) {
    return this.areas.softDelete(areaId);
  }
}
