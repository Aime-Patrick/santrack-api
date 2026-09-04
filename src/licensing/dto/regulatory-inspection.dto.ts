import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { RegulatoryInspectionResult } from '../entities/regulatory-inspection.entity';

export class RecordRegulatoryInspectionDto {
  @IsEnum(RegulatoryInspectionResult)
  result: RegulatoryInspectionResult;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
