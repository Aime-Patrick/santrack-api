import { IsEmail, IsString, MinLength } from 'class-validator';
import { IsSantrackPassword } from '../password-policy';

export class RegisterDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  email: string;

  @IsString()
  @IsSantrackPassword()
  password: string;

  @IsString()
  @MinLength(1, { message: 'Full name is required' })
  fullName: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  email: string;

  @IsString()
  password: string;
}

export class RequestPasswordResetDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1, { message: 'Reset token is required' })
  token: string;

  @IsString()
  @IsSantrackPassword()
  newPassword: string;
}

/** Self-service: confirm with current password before mailing the new inbox. */
export class RequestEmailChangeDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  email: string;

  @IsString()
  @MinLength(1, { message: 'Current password is required' })
  password: string;
}

export class VerifyEmailChangeDto {
  @IsString()
  @MinLength(1, { message: 'Verification token is required' })
  token: string;
}
