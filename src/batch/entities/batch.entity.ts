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
import { Product } from '../../product/entities/product.entity';
import { BatchStatus } from '../batch-status.enum';

/**
 * A production lot. Groups every item manufactured together so a recall can
 * reach all of them from a single decision (proposal section 11, use case 10).
 */
@Entity('batches')
@Unique('uk_batch_product_code', ['product', 'batchCode'])
@Index('idx_batch_product', ['product'])
export class Batch {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Product, { nullable: false, eager: true })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'batch_code', nullable: false })
  batchCode: string;

  @ManyToOne(() => Organization, { nullable: true, eager: true })
  @JoinColumn({ name: 'manufacturer_id' })
  manufacturer: Organization | null;

  @Column({ name: 'manufactured_on', type: 'date', nullable: true })
  manufacturedOn: string | null;

  /** Null for products that do not expire. */
  @Column({ name: 'expires_on', type: 'date', nullable: true })
  expiresOn: string | null;

  @Column({ type: 'enum', enum: BatchStatus, default: BatchStatus.ACTIVE })
  status: BatchStatus;

  @Column({ name: 'status_reason', type: 'varchar', length: 1000, nullable: true })
  statusReason: string | null;

  @Column({ name: 'status_changed_at', type: 'timestamptz', nullable: true })
  statusChangedAt: Date | null;

  /**
   * What the lot was before a recall, so lifting one restores the verdict it
   * had earned rather than guessing. A manufactured lot goes back to APPROVED
   * and a catalogue lot to ACTIVE, and neither is silently promoted.
   */
  @Column({ name: 'previous_status', type: 'enum', enum: BatchStatus, nullable: true })
  previousStatus: BatchStatus | null;

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
