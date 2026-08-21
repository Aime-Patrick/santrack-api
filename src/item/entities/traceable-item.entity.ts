import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { Batch } from '../../batch/entities/batch.entity';
import { Location } from '../../location/entities/location.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import { ItemKind, ItemStatus, PackageType, SealState } from '../item.enums';

/**
 * One permanent QR identity - either an individual product unit or a physical
 * container. Units and containers share one table because they share the same
 * lifecycle: both are scanned, held, moved, sold and ended, and both can sit
 * inside a parent container. Containment is the self-reference "parent",
 * which supports arbitrary depth (pallet -> carton -> box -> unit).
 *
 * The QR value never changes. Everything that happens to the physical thing is
 * recorded as a TraceabilityEvent against this row; the columns here are only
 * the fast-queryable current state derived from those events.
 */
@Entity('traceable_items')
@Index('idx_item_parent', ['parent'])
@Index('idx_item_holder', ['holder'])
@Index('idx_item_batch', ['batch'])
@Index('idx_item_product', ['product'])
export class TraceableItem {
  @PrimaryGeneratedColumn()
  id: number;

  /** The permanent QR payload. Globally unique, never reused (rules 1 and 2). */
  @Index({ unique: true })
  @Column({ name: 'qr_code', nullable: false, update: false })
  qrCode: string;

  /** Human-readable label printed alongside the QR, e.g. ST-LPT-000001. */
  @Index({ unique: true })
  @Column({ nullable: false, update: false })
  code: string;

  @Column({ type: 'enum', enum: ItemKind, nullable: false, update: false })
  kind: ItemKind;

  /** Set for containers only. */
  @Column({ name: 'package_type', type: 'enum', enum: PackageType, nullable: true })
  packageType: PackageType | null;

  /** Set for units; null for mixed containers. */
  @ManyToOne(() => Product, { nullable: true, eager: true })
  @JoinColumn({ name: 'product_id' })
  product: Product | null;

  @ManyToOne(() => Batch, { nullable: true, eager: true })
  @JoinColumn({ name: 'batch_id' })
  batch: Batch | null;

  @Column({ name: 'serial_number', type: 'varchar', nullable: true })
  serialNumber: string | null;

  /** Units this identity represents. 1 for a serialised unit. */
  @Column({ nullable: false, default: 1 })
  quantity: number;

  @Column({ type: 'enum', enum: ItemStatus, default: ItemStatus.ACTIVE })
  status: ItemStatus;

  /** Meaningful for containers only. */
  @Column({ name: 'seal_state', type: 'enum', enum: SealState, nullable: true })
  sealState: SealState | null;

  /** The container currently holding this item, if any. */
  @ManyToOne(() => TraceableItem, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: TraceableItem | null;

  /**
   * The business in custody. After a final consumer sale this keeps pointing
   * at the shop that sold it - the consumer is not an account - so the chain
   * still records which business last handled the product, while consumerRef
   * marks that custody has passed out of the trade.
   */
  @ManyToOne(() => Organization, { nullable: true, eager: true })
  @JoinColumn({ name: 'holder_id' })
  holder: Organization | null;

  @ManyToOne(() => Location, { nullable: true, eager: true })
  @JoinColumn({ name: 'location_id' })
  location: Location | null;

  /**
   * Minimal reference to a final consumer (phone, receipt number, opaque id).
   * Exposed only to callers permitted to see consumer information.
   */
  @Column({ name: 'consumer_ref', type: 'varchar', nullable: true })
  consumerRef: string | null;

  /** Copied from the batch so expiry checks need no join. ISO yyyy-MM-dd. */
  @Column({ name: 'expires_on', type: 'date', nullable: true })
  expiresOn: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /** Guards concurrent scans of the same physical item. */
  @VersionColumn()
  version: number;

  isPackage(): boolean {
    return this.kind === ItemKind.PACKAGE;
  }

  /**
   * ISO dates compare correctly as strings, so expiry needs no Date parsing
   * and no timezone reasoning - a shelf date is a calendar date, and the
   * calendar date it expires on is the same in every timezone that reads it.
   */
  isExpired(on: string = today()): boolean {
    return this.expiresOn !== null && this.expiresOn < on;
  }
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
