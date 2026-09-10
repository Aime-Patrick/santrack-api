import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class ApplyForProductRegistrationDto {
  @IsString()
  @MinLength(2, { message: 'Product name is required' })
  productName: string;

  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @IsInt()
  facilityId?: number;

  @IsOptional()
  @IsInt()
  productId?: number;

  @IsOptional()
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsString()
  intendedUse?: string;

  @IsOptional()
  @IsString()
  targetConsumer?: string;

  @IsOptional()
  @IsArray()
  ingredients?: Array<{ name: string; percentage?: number; purpose?: string }>;

  @IsOptional()
  @IsArray()
  netContents?: string[];

  @IsOptional()
  @IsInt()
  shelfLifeMonths?: number;

  @IsOptional()
  @IsString()
  storageConditions?: string;

  @IsOptional()
  @IsString()
  rsbStandardNumber?: string;
}

export enum ProductReviewDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ProductDecisionDto {
  @IsEnum(ProductReviewDecision)
  decision: ProductReviewDecision;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Use yyyy-MM-dd' })
  expiresOn?: string;
}
