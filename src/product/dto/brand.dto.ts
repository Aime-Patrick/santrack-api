import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateBrandDto {
  /**
   * The mark as it is written on the pack. The code is derived from it — see
   * `deriveCode` — so there is nothing else to fill in.
   */
  @IsString()
  @MinLength(2, { message: 'A brand name is required' })
  name: string;
}

export class UpdateBrandDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'A brand name is required' })
  name?: string;

  /** False withdraws it, true brings it back. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
