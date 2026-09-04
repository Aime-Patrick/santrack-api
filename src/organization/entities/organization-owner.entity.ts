import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from './organization.entity';

/**
 * An owner of the organization.
 * Collected during onboarding to match Rwanda's business registration
 * requirements (ownership transparency).
 */
@Entity('organization_owners')
@Index('idx_org_owner_org', ['organization'])
export class OrganizationOwner {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id', nullable: false })
  organizationId: number;

  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone: string | null;

  /** Percentage of ownership (0-100). */
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: false })
  percentage: number;

  /** National ID or passport number. */
  @Column({ name: 'id_number', type: 'varchar', length: 100, nullable: true })
  idNumber: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
