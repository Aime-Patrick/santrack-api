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
 * A carrier the organization dispatches with - typically a third-party
 * transport company, or the organization's own fleet registered under its
 * own name. The shipment references a transporter, and the transporter owns
 * the vehicles and drivers that physically carry the goods.
 */
@Entity('transporters')
@Unique('uk_transporter_org_code', ['organization', 'code'])
@Index('idx_transporter_org', ['organization'])
export class Transporter {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ nullable: false })
  name: string;

  /** Stable short code, unique within the organization. */
  @Column({ nullable: false })
  code: string;

  @Column({ name: 'contact_person', type: 'varchar', nullable: true })
  contactPerson: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}