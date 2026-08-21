import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Location } from '../../location/entities/location.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { TraceableItem } from '../../item/entities/traceable-item.entity';

export enum TransferStatus {
  /** Sent, awaiting the destination party's confirmation. */
  DISPATCHED = 'DISPATCHED',
  /** All items confirmed received. */
  RECEIVED = 'RECEIVED',
  /** Some items received, some still missing — open for the rest. */
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  /** Pulled back by the sender before receipt. */
  CANCELLED = 'CANCELLED',
}

/**
 * One handover between two parties. Dispatch and receipt are separate steps so
 * goods in transit are visible as such, and a discrepancy at the receiving end
 * surfaces instead of disappearing (business rule 6).
 */
@Entity('transfers')
@Index('idx_transfer_source', ['sourceOrganization'])
@Index('idx_transfer_destination', ['destinationOrganization'])
export class Transfer {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ nullable: false })
  reference: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'source_organization_id' })
  sourceOrganization: Organization;

  @ManyToOne(() => Location, { nullable: true, eager: true })
  @JoinColumn({ name: 'source_location_id' })
  sourceLocation: Location | null;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'destination_organization_id' })
  destinationOrganization: Organization;

  @ManyToOne(() => Location, { nullable: true, eager: true })
  @JoinColumn({ name: 'destination_location_id' })
  destinationLocation: Location | null;

  @Column({ type: 'enum', enum: TransferStatus, default: TransferStatus.DISPATCHED })
  status: TransferStatus;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'dispatched_by_id' })
  dispatchedBy: User | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'received_by_id' })
  receivedBy: User | null;

  @CreateDateColumn({ name: 'dispatched_at' })
  dispatchedAt: Date;

  @Column({ name: 'received_at', type: 'timestamptz', nullable: true })
  receivedAt: Date | null;

  /**
   * Comma-separated item codes that did not arrive during a partial receipt.
   * Cleared once the remaining items are received or the discrepancy is
   * otherwise resolved.
   */
  @Column({ name: 'missing_items', type: 'varchar', nullable: true })
  missingItems: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;
}

/** One scanned identity travelling on a transfer. */
@Entity('transfer_lines')
@Index('idx_transfer_line_transfer', ['transfer'])
export class TransferLine {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Transfer, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transfer_id' })
  transfer: Transfer;

  @ManyToOne(() => TraceableItem, { nullable: false, eager: true })
  @JoinColumn({ name: 'item_id' })
  item: TraceableItem;
}
