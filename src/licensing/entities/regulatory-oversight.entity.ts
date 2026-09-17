import { CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, Column } from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';
import { RegulatoryAuthority } from './regulatory-authority.entity';

export enum RegulatoryOversightMode {
  /** Aggregate health only — no case queue or follow-up actions. */
  OBSERVE = 'OBSERVE',
  /**
   * High-regulator supervision: follow the subordinate authority's open
   * queue and nudge them. Does not transfer case ownership or create orgs.
   */
  SUPERVISE = 'SUPERVISE',
}

/**
 * Platform-granted link from one regulator org (the overseer) to another
 * authority desk. System admin assigns the link; the overseer never creates
 * regulators — they only supervise what the platform put in their scope.
 */
@Entity('regulatory_oversight_scopes')
@Unique('UQ_regulatory_oversight_scope', ['oversightOrganization', 'authority'])
@Index('idx_regulatory_oversight_scope_organization', ['oversightOrganization'])
export class RegulatoryOversightScope {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'oversight_organization_id' })
  oversightOrganization: Organization;

  @ManyToOne(() => RegulatoryAuthority, { nullable: false, eager: true })
  @JoinColumn({ name: 'authority_id' })
  authority: RegulatoryAuthority;

  @Column({
    type: 'enum',
    enum: RegulatoryOversightMode,
    default: RegulatoryOversightMode.OBSERVE,
  })
  mode: RegulatoryOversightMode;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
