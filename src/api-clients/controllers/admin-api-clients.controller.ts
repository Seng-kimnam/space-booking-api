import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Secured } from '../../common/decorators/secured.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { UserRole } from '../../common/enums';
import {
  ApiClientPageResponseDto,
  ApiClientResponseDto,
  ApiClientWithKeyResponseDto,
  CreateApiClientDto,
  UpdateApiClientDto,
} from '../dto/api-client.dto';
import { ApiClientsService } from '../services/api-clients.service';

/** docs/api-endpoints.md section 8. The full key is returned only by create and rotate-key. */
@ApiTags('API clients')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@Secured(UserRole.ADMIN)
@Controller('admin/api-clients')
export class AdminApiClientsController {
  constructor(private readonly clients: ApiClientsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an API client; returns its key once' })
  @ApiCreatedResponse({ type: ApiClientWithKeyResponseDto })
  @ApiConflictResponse({ description: 'Name already used' })
  create(@Body() dto: CreateApiClientDto): Promise<ApiClientWithKeyResponseDto> {
    return this.clients.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List API clients' })
  @ApiOkResponse({ type: ApiClientPageResponseDto })
  list(@Query() query: PaginationQueryDto): Promise<ApiClientPageResponseDto> {
    return this.clients.list(query);
  }

  @Get(':clientId')
  @ApiOperation({ summary: 'Get one API client' })
  @ApiOkResponse({ type: ApiClientResponseDto })
  @ApiNotFoundResponse()
  get(@Param('clientId', ParseUUIDPipe) clientId: string): Promise<ApiClientResponseDto> {
    return this.clients.get(clientId);
  }

  @Patch(':clientId')
  @ApiOperation({ summary: 'Rename, change scopes, or deactivate (isActive=false) an API client' })
  @ApiOkResponse({ type: ApiClientResponseDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Name already used' })
  update(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: UpdateApiClientDto,
  ): Promise<ApiClientResponseDto> {
    return this.clients.update(clientId, dto);
  }

  @Post(':clientId/rotate-key')
  @ApiOperation({ summary: 'Issue a new key; the old key stops working immediately' })
  @ApiCreatedResponse({ type: ApiClientWithKeyResponseDto })
  @ApiNotFoundResponse()
  rotateKey(@Param('clientId', ParseUUIDPipe) clientId: string): Promise<ApiClientWithKeyResponseDto> {
    return this.clients.rotateKey(clientId);
  }
}
