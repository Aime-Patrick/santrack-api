import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';

/**
 * A supplier in the buyer's directory (DR-10). Org-scoped: each trading
 * organization keeps its own list. Optional linkedOrganizationId names a
 * platform seller when the counterparty is itself on SANTRACK.
 */
@Entity('suppliers')
@Unique('uk_supplier_org_code', ['organization', 'code'])
@Index('idx_supplier_org', ['organization'])
export class Supplier {
  @PrimaryGeneratedColumn()
  id: number;

  /** The buyer — tenant that owns this directory row. */
  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** Stable short code, unique within the buyer organization. */
  @Column({ nullable: false })
  code: string;

  @Column({ nullable: false })
  name: string;

  /**
   * The seller organization when the supplier is a business on the platform.
   * Null for off-platform vendors. Never inferred from name/email.
   */
  @ManyToOne(() => Organization, { nullable: true, eager: true })
  @JoinColumn({ name: 'linked_organization_id' })
  linkedOrganization: Organization | null;

  @Column({ type: 'varchar', nullable: true })
  contact: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
