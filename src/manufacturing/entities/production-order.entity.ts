import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Batch } from '../../batch/entities/batch.entity';
import { Facility } from '../../organization/entities/facility.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import { ProductionOrderStatus } from '../manufacturing.enums';
import { BillOfMaterial } from './bill-of-material.entity';
import { Machine } from './machine.entity';
import { RawMaterial } from './raw-material.entity';

/**
 * One planned and executed run of production: what was going to be made, what
 * actually came out, and the batch the finished goods hang off. The batch is
 * what ties manufacturing to traceability: registering units against it is
 * "finished-goods registration" (proposal section 3).
 */
@Entity('production_orders')
@Index('idx_production_order_org', ['organization'])
@Index('idx_production_order_product', ['product'])
@Index('idx_production_order_status', ['status'])
export class ProductionOrder {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'order_number', nullable: false })
  orderNumber: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Product, { nullable: false, eager: true })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @ManyToOne(() => BillOfMaterial, { nullable: true, eager: true })
  @JoinColumn({ name: 'bom_id' })
  bom: BillOfMaterial | null;

  @ManyToOne(() => Machine, { nullable: true, eager: true })
  @JoinColumn({ name: 'machine_id' })
  machine: Machine | null;

  @Column({ name: 'planned_quantity', type: 'int', nullable: false })
  plannedQuantity: number;

  @Column({ name: 'produced_quantity', type: 'int', default: 0 })
  producedQuantity: number;

  @Column({ type: 'enum', enum: ProductionOrderStatus, default: ProductionOrderStatus.PLANNED })
  status: ProductionOrderStatus;

  /** Planning dates, not facts - the actual start/finish are timestamps. */
  @Column({ name: 'scheduled_start_on', type: 'date', nullable: true })
  scheduledStartOn: string | null;

  @Column({ name: 'scheduled_end_on', type: 'date', nullable: true })
  scheduledEndOn: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  /** Opened with the order; register finished goods against it once QC approves. */
  @ManyToOne(() => Batch, { nullable: true, eager: true })
  @JoinColumn({ name: 'batch_id' })
  batch: Batch | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /**
   * The site this run happens at (DR-02). Nullable: a business with no plant is
   * not forced to invent one, and historic orders were backfilled to their
   * organization's main site.
   *
   * Carried onto the batch at creation, so a recall can name the plant without
   * walking back through the order.
   */
  @ManyToOne(() => Facility, { nullable: true, eager: true })
  @JoinColumn({ name: 'facility_id' })
  facility: Facility | null;

  @Column({ name: 'facility_id', type: 'int', nullable: true })
  facilityId: number | null;

  /**
   * The eligibility decision that permitted this run (DR-07 §5 M2).
   *
   * Held as a plain id rather than a relation on purpose: the decision lives in
   * the licensing module, and manufacturing reaching into the licence tables to
   * work out for itself whether a run is permitted is the thing DR §24
   * invariant 10 exists to prevent. The order records *which* decision it was
   * created under; reading that decision is licensing's job.
   *
   * Null on every order created before DR-07, and never backfilled. They were
   * made before any eligibility decision existed, and inventing one for them
   * would fabricate an audit record.
   */
  @Column({ name: 'eligibility_decision_id', type: 'bigint', nullable: true })
  eligibilityDecisionId: string | null;
}

/**
 * What was allocated to an order and what has actually been consumed.
 * Allocation is the plan (snapshotted from the BOM, or added by hand);
 * consumption is the fact, and cannot exceed allocation - the line cannot eat
 * more than it was given without someone deciding to give it more.
 */
@Entity('production_order_materials')
@Index('idx_pom_order', ['productionOrder'])
export class ProductionOrderMaterial {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ProductionOrder, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'production_order_id' })
  productionOrder: ProductionOrder;

  @ManyToOne(() => RawMaterial, { nullable: false, eager: true })
  @JoinColumn({ name: 'material_id' })
  material: RawMaterial;

  @Column({ name: 'allocated_quantity', type: 'numeric', precision: 14, scale: 3, default: 0 })
  allocatedQuantity: string;

  @Column({ name: 'consumed_quantity', type: 'numeric', precision: 14, scale: 3, default: 0 })
  consumedQuantity: string;

  /** Copied from the BOM line when allocation is auto-generated. */
  @Column({ name: 'wastage_percent', type: 'numeric', precision: 5, scale: 2, default: 0 })
  wastagePercent: string;
}
