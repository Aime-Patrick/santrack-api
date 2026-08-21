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
import { Facility } from '../../organization/entities/facility.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { MachineStatus } from '../manufacturing.enums';

/**
 * A physical machine or production line. A production order can name the
 * machine it ran on, so defect rates can be traced back to equipment rather
 * than only to a batch (proposal section 3, "machine/production-line records").
 */
@Entity('machines')
@Unique('uk_machine_org_code', ['organization', 'code'])
@Index('idx_machine_org', ['organization'])
export class Machine {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** Stable short code, unique within the organization. */
  @Column({ nullable: false })
  code: string;

  @Column({ nullable: false })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  type: string | null;

  @Column({ type: 'enum', enum: MachineStatus, default: MachineStatus.ACTIVE })
  status: MachineStatus;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /**
   * The site this belongs to (DR-02). Nullable: a business with no plant is not
   * forced to invent one, and historic rows were backfilled to their
   * organization's main site.
   */
  @ManyToOne(() => Facility, { nullable: true, eager: true })
  @JoinColumn({ name: 'facility_id' })
  facility: Facility | null;

  @Column({ name: 'facility_id', type: 'int', nullable: true })
  facilityId: number | null;

}
