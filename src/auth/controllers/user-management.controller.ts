import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Capability } from '../capabilities';
import { CurrentUser, RequireCapability } from '../../common/decorators';
import { User } from '../entities/user.entity';
import {
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserDto,
} from '../dto/user-management.dto';
import { UserManagementService } from '../services/user-management.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('api/users')
export class UserController {
  constructor(private readonly userMgmt: UserManagementService) {}

  /**
   * Create a new user within an organization. Org admins can only create
   * users in their own organization; system admins can create anywhere.
   */
  @Post()
  @RequireCapability(Capability.MANAGE_USERS)
  async create(@CurrentUser() actor: User, @Body() dto: CreateUserDto) {
    return this.userMgmt.create(actor, dto);
  }

  /**
   * List users. System admins see all users; org admins see only their
   * own organization's users. Pass ?organizationId= to filter explicitly.
   */
  @Get()
  @RequireCapability(Capability.MANAGE_USERS)
  async list(
    @CurrentUser() actor: User,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.userMgmt.list(
      actor,
      organizationId ? parseInt(organizationId, 10) : undefined,
    );
  }

  /** Get a single user by ID. */
  @Get(':id')
  @RequireCapability(Capability.MANAGE_USERS)
  async get(
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.userMgmt.get(actor, id);
  }

  /**
   * Update a user's profile or role. Org admins cannot promote to
   * SYSTEM_ADMIN.
   */
  @Patch(':id')
  @RequireCapability(Capability.MANAGE_USERS)
  async update(
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userMgmt.update(actor, id, dto);
  }

  /** Reset a user's password. */
  @Post(':id/reset-password')
  @RequireCapability(Capability.MANAGE_USERS)
  async resetPassword(
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPasswordDto,
  ) {
    await this.userMgmt.resetPassword(actor, id, dto);
    return { message: 'Password reset successfully' };
  }

  /**
   * Deactivate (remove) a user. A user cannot deactivate their own account.
   */
  @Delete(':id')
  @RequireCapability(Capability.MANAGE_USERS)
  async remove(
    @CurrentUser() actor: User,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.userMgmt.remove(actor, id);
    return { message: 'User deactivated successfully' };
  }
}
