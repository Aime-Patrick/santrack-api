import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CustomerSegment, CustomerType } from '../commerce.enums';

export class CreateCustomerDto {
  @IsString()
  @MinLength(1, { message: 'Customer name is required' })
  name: string;

  @IsEnum(CustomerType)
  type: CustomerType;

  @IsOptional()
  @IsEnum(CustomerSegment)
  segment?: CustomerSegment;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactPerson?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsInt()
  creditLimit?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /**
   * The buyer's own organization, when the buyer is a business on the
   * platform. Set it and fulfilment transfers the goods to them; leave it and
   * fulfilment sells the goods out of the chain.
   */
  @IsOptional()
  @IsInt()
  buyerOrganizationId?: number;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEnum(CustomerType)
  type?: CustomerType;

  @IsOptional()
  @IsEnum(CustomerSegment)
  segment?: CustomerSegment;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactPerson?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsInt()
  creditLimit?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /**
   * The buyer's own organization, when the buyer is a business on the
   * platform. Set it and fulfilment transfers the goods to them; leave it and
   * fulfilment sells the goods out of the chain.
   */
  @IsOptional()
  @IsInt()
  buyerOrganizationId?: number;
}