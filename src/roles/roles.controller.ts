import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
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
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { Roles } from '../auth/decorators/role.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums';
import { CreateRoleDto } from './dto/create-role.dto';
import { RoleIdParamDto, RoleQueryDto } from './dto/role-query.dto';
import { RolePageResponseDto, RoleResponseDto } from './dto/role-response.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

// AuthGuard (valid JWT -> 401) then RolesGuard (ADMIN only -> 403).
// Per-controller pipe because there is no global one yet; drop it when one is added.
@ApiTags('Roles')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({ description: 'Caller is not an ADMIN' })
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller('admin/roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a role' })
  @ApiCreatedResponse({ type: RoleResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid role name' })
  @ApiConflictResponse({ description: 'Role name already exists' })
  async create(@Body() dto: CreateRoleDto): Promise<RoleResponseDto> {
    return RoleResponseDto.from(await this.rolesService.create(dto));
  }

  @Get()
  @ApiOperation({ summary: 'List roles (paginated, optional name search)' })
  @ApiOkResponse({ type: RolePageResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid page, limit or search' })
  findAll(@Query() query: RoleQueryDto): Promise<RolePageResponseDto> {
    return this.rolesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one role' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiBadRequestResponse({ description: 'id is not a positive integer' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async findOne(@Param() { id }: RoleIdParamDto): Promise<RoleResponseDto> {
    return RoleResponseDto.from(await this.rolesService.findOne(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a role' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid id or role name' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  @ApiConflictResponse({
    description: 'Role name already exists, or ADMIN/USER cannot be renamed',
  })
  async update(
    @Param() { id }: RoleIdParamDto,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleResponseDto> {
    return RoleResponseDto.from(await this.rolesService.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a role' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiNoContentResponse({ description: 'Role deleted' })
  @ApiBadRequestResponse({ description: 'id is not a positive integer' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  @ApiConflictResponse({ description: 'ADMIN and USER cannot be deleted' })
  async remove(@Param() { id }: RoleIdParamDto): Promise<void> {
    await this.rolesService.remove(id);
  }
}
