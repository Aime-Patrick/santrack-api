import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Facility } from '../../organization/entities/facility.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { RegulatoryCase } from './regulatory-case.entity';

export enum RegulatoryInspectionResult {
  PASS = 'PASS',
  CONDITIONAL = 'CONDITIONAL',
  FAIL = 'FAIL',
}

/**
 * A regulator's field decision. It is distinct from factory QC: it may concern
 * a facility, licence condition or supply-chain evidence, and it never rewrites
 * a batch's manufacturing-quality verdict.
 */
@Entity('regulatory_inspections')
@Index('idx_regulatory_inspection_case', ['case'])
@Index('idx_regulatory_inspection_organization', ['organization'])
export class RegulatoryInspection {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => RegulatoryCase, { nullable: false, eager: true })
  @JoinColumn({ name: 'case_id' })
  case: RegulatoryCase;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Facility, { nullable: true, eager: true })
  @JoinColumn({ name: 'facility_id' })
  facility: Facility | null;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'regulator_id' })
  regulator: Organization;

  @ManyToOne(() => User, { nullable: false, eager: true })
  @JoinColumn({ name: 'inspector_id' })
  inspector: User;

  @Column({ type: 'enum', enum: RegulatoryInspectionResult })
  result: RegulatoryInspectionResult;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'inspected_at', type: 'timestamptz' })
  inspectedAt: Date;
}
