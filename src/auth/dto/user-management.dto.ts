import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { UserRole } from '../user-role.enum';

export class CreateUserDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  email: string;

  /**
   * Required unless `generatePassword` is true. Invited users always start
   * with mustChangePassword so a shared temporary secret cannot linger.
   */
  @ValidateIf((dto: CreateUserDto) => !dto.generatePassword)
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password?: string;

  @IsOptional()
  @IsBoolean()
  generatePassword?: boolean;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsInt({ message: 'Organization ID is required' })
  organizationId: number;

  @IsEnum(UserRole, { message: 'A valid role is required' })
  role: UserRole;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Full name cannot be empty' })
  fullName?: string;

  @IsOptional()
  @IsEnum(UserRole, { message: 'A valid role is required' })
  role?: UserRole;

  @IsOptional()
  @IsInt()
  organizationId?: number;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  newPassword: string;
}
