import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Opens a new operational site (DR-07, WU-1).
 *
 * The code is not accepted from the caller. It is drawn from the shared
 * counter, for the same reason a location code is: it exists to be printed and
 * scanned, and two sites answering to one code would misroute production.
 */
export class CreateFacilityDto {
  @IsString()
  @MinLength(2, { message: 'A site needs a name' })
  name: string;

  @IsOptional()
  @IsString()
  address?: string;
}

/**
 * Corrects a site record.
 *
 * Every field is optional because the three reasons to touch a site are
 * independent: it was named wrongly, it moved, or it has closed. `code` is
 * absent by design — the entity refuses to update it, and a site whose printed
 * reference changed would break every label already in circulation.
 */
export class UpdateFacilityDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'A site needs a name' })
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
