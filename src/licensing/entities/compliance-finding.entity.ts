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
import { Organization } from '../../organization/entities/organization.entity';
import { ComplianceFindingType, LicensedActivity } from '../licensing.enums';
import { License } from './license.entity';

/**
 * A record that an organization did something its licence did not cover
 * (technical proposal section 10, the regulator's compliance panel).
 *
 * Attached to the organization rather than to a licence, because the case that
 * matters most - a business operating with no licence at all - has no licence
 * to attach to. `LicenseEvent` cannot serve here for exactly that reason: its
 * licence column is NOT NULL.
 *
 * Append-only, like every other record the regulator may have to rely on. A
 * finding is a historical fact about a moment; whether the organization is
 * compliant *now* is a live question answered from the licence itself, so
 * there is deliberately no "resolved" flag to fall out of step with reality.
 */
@Entity('compliance_findings')
@Index('idx_finding_organization', ['organization'])
@Index('idx_finding_recorded', ['recordedAt'])
export class ComplianceFinding {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'enum', enum: ComplianceFindingType, nullable: false })
  type: ComplianceFindingType;

  /** The activity that needed covering. */
  @Column({ type: 'enum', enum: LicensedActivity, nullable: true })
  activity: LicensedActivity | null;

  /** What the operator was doing, phrased as they would recognise it. */
  @Column({ nullable: false })
  action: string;

  /** The licence relied on, where there was one. */
  @ManyToOne(() => License, { nullable: true })
  @JoinColumn({ name: 'license_id' })
  license: License | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  detail: string | null;

  @CreateDateColumn({ name: 'recorded_at' })
  recordedAt: Date;
}
