import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { CurrentUser, Public, RequireCapability } from '../../common/decorators';
import { Capability } from '../capabilities';
import { RateLimit } from '../../security/rate-limit.guard';
import { ChangePasswordDto } from '../dto/user-management.dto';
import {
  LoginDto,
  RegisterDto,
  RequestEmailChangeDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
  VerifyEmailChangeDto,
} from '../dto/auth.dto';
import {
  clearSessionCookie,
  sessionTtlSeconds,
  setSessionCookie,
} from '../session-cookie';
import { User } from '../entities/user.entity';
import { AuthService, type AuthResult, type LoginResult } from '../services/auth.service';
import { TraceabilityRuleException } from '../../common/errors';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;
}

class SetAvatarDto {
  /** DiceBear library URL, or null to clear. */
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  avatarUrl: string | null;
}

class MfaCodeDto {
  @IsString()
  @MinLength(6)
  @MaxLength(8)
  code: string;
}

class MfaVerifyLoginDto {
  @IsString()
  @MinLength(20)
  mfaToken: string;

  @IsString()
  @MinLength(6)
  @MaxLength(8)
  code: string;
}

class MfaDisableDto {
  @IsString()
  @MinLength(1)
  password: string;

  @IsString()
  @MinLength(6)
  @MaxLength(8)
  code: string;
}

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @Public()
  @RateLimit('register', 20, 60 * 60 * 1000)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(dto);
    this.attachSession(res, result.token);
    return result;
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @RateLimit('login', 10, 15 * 60 * 1000)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const result = await this.auth.login(dto, req.ip);
    if ('token' in result) {
      this.attachSession(res, result.token);
    }
    return result;
  }

  @Post('mfa/verify-login')
  @Public()
  @HttpCode(200)
  @RateLimit('login', 10, 15 * 60 * 1000)
  async verifyMfaLogin(
    @Body() dto: MfaVerifyLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const result = await this.auth.verifyMfaLogin(
      dto.mfaToken,
      dto.code,
      req.ip,
    );
    this.attachSession(res, result.token);
    return result;
  }

  @Post('mfa/setup')
  @HttpCode(200)
  beginMfaSetup(@CurrentUser() user: User) {
    return this.auth.beginMfaSetup(user);
  }

  @Post('mfa/confirm')
  @HttpCode(200)
  confirmMfaSetup(@CurrentUser() user: User, @Body() dto: MfaCodeDto) {
    return this.auth.confirmMfaSetup(user, dto.code);
  }

  @Post('mfa/disable')
  @HttpCode(200)
  disableMfa(@CurrentUser() user: User, @Body() dto: MfaDisableDto) {
    return this.auth.disableMfa(user, dto.password, dto.code);
  }

  @Post('logout')
  @Public()
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    clearSessionCookie(res);
    return { success: true };
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(200)
  @RateLimit('forgot-password', 5, 15 * 60 * 1000)
  async forgotPassword(@Body() dto: RequestPasswordResetDto) {
    return this.auth.requestPasswordReset(dto);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(200)
  @RateLimit('reset-password', 10, 15 * 60 * 1000)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.changePassword(user, dto);
    this.attachSession(res, result.token);
    return result;
  }

  @Get('me')
  async me(@CurrentUser() user: User) {
    return this.auth.me(user);
  }

  @Patch('me')
  @HttpCode(200)
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(user, dto);
  }

  @Post('me/email-change')
  @HttpCode(200)
  @RateLimit('email-change', 5, 60 * 60 * 1000)
  async requestEmailChange(
    @CurrentUser() user: User,
    @Body() dto: RequestEmailChangeDto,
  ) {
    return this.auth.requestEmailChange(user, dto);
  }

  @Delete('me/email-change')
  @HttpCode(200)
  async cancelEmailChange(@CurrentUser() user: User) {
    return this.auth.cancelEmailChange(user);
  }

  @Post('verify-email-change')
  @Public()
  @HttpCode(200)
  @RateLimit('verify-email-change', 20, 60 * 60 * 1000)
  async verifyEmailChange(@Body() dto: VerifyEmailChangeDto) {
    return this.auth.verifyEmailChange(dto.token);
  }

  @Patch('me/avatar')
  @HttpCode(200)
  async setLibraryAvatar(
    @CurrentUser() user: User,
    @Body() dto: SetAvatarDto,
  ) {
    return this.auth.setLibraryAvatar(user, dto.avatarUrl);
  }

  @Post('me/avatar')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @CurrentUser() user: User,
    @UploadedFile()
    file?: {
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    },
  ) {
    if (!file?.buffer?.length) {
      throw new TraceabilityRuleException('Choose an image file to upload');
    }
    return this.auth.uploadAvatar(user, file);
  }

  @Delete('me/avatar')
  @HttpCode(200)
  async clearAvatar(@CurrentUser() user: User) {
    return this.auth.clearAvatar(user);
  }

  @Get('me/avatar')
  async readAvatar(@CurrentUser() user: User) {
    const avatar = await this.auth.readAvatar(user);
    if (!avatar) {
      throw new TraceabilityRuleException('No uploaded avatar');
    }
    return new StreamableFile(avatar.content, {
      type: avatar.contentType,
      disposition: 'inline',
    });
  }

  @Get('capabilities')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  capabilities() {
    return this.auth.catalogue();
  }

  private attachSession(res: Response, token: string) {
    const expiresIn = this.config.get<string>('jwt.expiresIn');
    setSessionCookie(res, token, sessionTtlSeconds(expiresIn));
  }
}
