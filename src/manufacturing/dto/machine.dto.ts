import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateMachineDto {
  @IsString()
  @MinLength(1, { message: 'Machine name is required' })
  name: string;

  /** Omitted codes are generated. */
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  type?: string;
}
