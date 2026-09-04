import { IsInt } from 'class-validator';

export class GrantRegulatoryOversightDto {
  @IsInt()
  oversightOrganizationId: number;

  @IsInt()
  authorityId: number;
}
