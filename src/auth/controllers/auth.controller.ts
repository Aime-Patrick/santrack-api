import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, RequireCapability } from '../../common/decorators';
import { Capability } from '../capabilities';
import { RateLimit } from '../../security/rate-limit.guard';
import { LoginDto, RegisterDto } from '../dto/auth.dto';
import { User } from '../entities/user.entity';
import { AuthService } from '../services/auth.service';

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
