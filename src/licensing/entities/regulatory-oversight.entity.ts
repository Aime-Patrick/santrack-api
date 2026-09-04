import { CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';
import { RegulatoryAuthority } from './regulatory-authority.entity';

/** Read-only governance scope. It grants performance visibility, never case control. */
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
