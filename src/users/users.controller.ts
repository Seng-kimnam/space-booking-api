import { Body, Controller, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentAuthUser } from '../common/decorators/current-auth-user.decorator';
import { Secured } from '../common/decorators/secured.decorator';
import { UserRole } from '../common/enums';
import type { AuthUser } from '../common/types/auth-user';
import { MyProfileResponseDto, UpdateMyProfileDto } from './dto/user.dto';
import { UsersService } from './users.service';

/**
 * The caller's own account (docs/api-endpoints.md section 1). Reading the
 * profile is GET /auth/me. SUPER_ADMIN passes ADMIN routes (RolesInterceptor).
 */
@ApiTags('Users')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse()
@Secured(UserRole.USER, UserRole.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch('me')
  @ApiOperation({ summary: 'Update my profile (name, avatar)' })
  @ApiOkResponse({ type: MyProfileResponseDto })
  @ApiBadRequestResponse()
  updateMe(
    @CurrentAuthUser() user: AuthUser,
    @Body() dto: UpdateMyProfileDto,
  ): Promise<MyProfileResponseDto> {
    return this.users.updateMyProfile(user.id, dto);
  }
}
