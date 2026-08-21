import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateRouteDto {
  @IsString()
  @MinLength(1, { message: 'Route name is required' })
  name: string;

  @IsInt({ message: 'Source location is required' })
  sourceLocationId: number;

  @IsInt({ message: 'Destination location is required' })
  destinationLocationId: number;

  @IsOptional()
  @IsNumber()
  distanceKm?: number;

  @IsOptional()
  @IsNumber()
  expectedHours?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateRouteDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  sourceLocationId?: number;

  @IsOptional()
  @IsInt()
  destinationLocationId?: number;

  @IsOptional()
  @IsNumber()
  distanceKm?: number;

  @IsOptional()
  @IsNumber()
  expectedHours?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}