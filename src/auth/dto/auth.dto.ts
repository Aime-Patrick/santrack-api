import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
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
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  newPassword: string;
}
