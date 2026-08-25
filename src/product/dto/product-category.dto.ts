import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateProductCategoryDto {
  @IsString()
  @MinLength(2, { message: 'A category name is required' })
  name: string;

  /**
   * The stable machine name rules and integrations refer to.
   *
   * Optional, and normally omitted: "Dairy products" and "DAIRY_PRODUCTS" are
   * the same fact written twice, so the server derives one from the other
   * rather than asking a person to type both and keep them in step. Supply it
   * only to pin a code that does not follow from the name — an existing
   * external scheme, say.
   */
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'A category code is required' })
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'Use upper case letters, digits, underscore or dash for the code',
  })
  code?: string;

  /** The broader category this sits under. Taxonomy only — see DR-05. */
  @IsOptional()
  @IsInt({ message: 'Choose a parent from the catalogue' })
  parentId?: number;
}

export class UpdateProductCategoryDto {
  /**
   * The code is deliberately absent.
   *
   * Products, rules and integrations refer to a category by code; renaming one
   * silently re-points every reference. A category filed under the wrong code
   * is withdrawn and replaced, which leaves the old one readable for the
   * products already classified under it.
   */
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'A category name is required' })
  name?: string;

  @IsOptional()
  @IsInt({ message: 'Choose a parent from the catalogue' })
  parentId?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
