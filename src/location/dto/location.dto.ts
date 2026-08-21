import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { LocationType } from '../location-type.enum';

export class CreateLocationDto {
  @IsString()
  @MinLength(1, { message: 'Location name is required' })
  name: string;

  @IsEnum(LocationType)
  type: LocationType;

  @IsOptional()
  @IsString()
  address?: string;
}
