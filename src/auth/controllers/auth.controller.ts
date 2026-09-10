import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, RequireCapability } from '../../common/decorators';
import { Capability } from '../capabilities';
import { RateLimit } from '../../security/rate-limit.guard';
import { ChangePasswordDto } from '../dto/user-management.dto';
import {
  LoginDto,
  RegisterDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
} from '../dto/auth.dto';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { User } from '../entities/user.entity';
import { AuthService } from '../services/auth.service';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;
}

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Registration is open, so it is also the cheapest way to fill the user
  // table. Ten new accounts an hour from one address is generous for a real
  // business and useless for a script.
  @Post('register')
  @Public()
  @RateLimit('register', 20, 60 * 60 * 1000)
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  // Brute-force protection: the same wrong password cannot be tried all day.
  @Post('login')
  @Public()
  @HttpCode(200)
  @RateLimit('login', 20, 15 * 60 * 1000)
  async login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // Five requests per address per quarter-hour is plenty for a human and
  // useless for someone harvesting or flooding inboxes.
  @Post('forgot-password')
  @Public()
  @HttpCode(200)
  @RateLimit('forgot-password', 5, 15 * 60 * 1000)
  async forgotPassword(@Body() dto: RequestPasswordResetDto) {
    return this.auth.requestPasswordReset(dto);
  }

  // The token itself is the gate: replaying it fails, guessing it is not
  // feasible. The rate limit just keeps a hammering client from burning CPU.
  @Post('reset-password')
  @Public()
  @HttpCode(200)
  @RateLimit('reset-password', 10, 15 * 60 * 1000)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  /** Replaces the caller's password and clears mustChangePassword. */
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user, dto);
  }

  /**
   * Who the bearer token belongs to, and what they may act as.
   *
   * Carries the caller's resolved capability list. The browser draws its
   * navigation from that list rather than from a table of its own, so a role
   * change here is a role change there.
   */
  @Get('me')
  async me(@CurrentUser() user: User) {
    return this.auth.me(user);
  }

  /** Self-service: update the caller's own display name. */
  @Patch('me')
  @HttpCode(200)
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(user, dto);
  }

  /**
   * The role/capability reference table: what every capability means and
   * which roles hold it. Reference data, not anybody's data, so any signed-in
   * user may read it - it is what the Roles screen renders.
   */
  @Get('capabilities')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  capabilities() {
    return this.auth.catalogue();
  }
}
