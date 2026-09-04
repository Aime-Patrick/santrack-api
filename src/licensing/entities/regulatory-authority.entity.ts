import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';

/** A configurable government authority; its mandate is distinct from geography. */
@Entity('regulatory_authorities')
export class RegulatoryAuthority {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 180 })
  name: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  mandates: string[];

  /** Case categories accepted by this authority's own triage team. */
  @Column({ name: 'case_categories', type: 'jsonb', default: () => "'[]'::jsonb" })
  caseCategories: string[];

  /** Authority-defined operational teams; no geographic model is assumed. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  teams: string[];

  /** Optional authority-owned target for accepting or declining a referral. */
  @Column({ name: 'referral_response_days', type: 'integer', nullable: true })
  referralResponseDays: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** The organization whose officers operate this authority's cases. */
  @Index({ unique: true })
  @ManyToOne(() => Organization, { nullable: true, eager: true })
  @JoinColumn({ name: 'operating_organization_id' })
  operatingOrganization: Organization | null;
}
