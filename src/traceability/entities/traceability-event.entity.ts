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
import { Batch } from '../../batch/entities/batch.entity';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { Location } from '../../location/entities/location.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { EventType } from '../event-type.enum';

/**
 * An immutable record of one thing that happened to one QR identity. Rows are
 * never updated or deleted: a mistake is corrected by appending a CORRECTION
 * event that points back at the entry it compensates (business rule 14).
 *
 * Scalar columns are marked non-updatable so the ORM itself refuses to write
 * them twice. Relations cannot carry that flag, so they are protected by
 * convention instead: EventRecorder is the only writer, and it only ever
 * inserts. This is the historical record the whole platform rests on - nothing
 * else in the codebase may save a TraceabilityEvent that already has an id.
 */
@Entity('traceability_events')
@Index('idx_event_item', ['item'])
@Index('idx_event_batch', ['batch'])
@Index('idx_event_occurred', ['occurredAt'])
@Index('idx_event_type', ['type'])
export class TraceabilityEvent {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * The identity this happened to, where one exists.
   *
   * Nullable because the canonical lifecycle assigns unit identities only
   * after QC approves the batch: production start, material issue, completion
   * and the QC verdict itself all happen while there is nothing to point at
   * yet. Those events address the batch instead. Exactly one of `item` and
   * `batch` is set, enforced by a check constraint in the database rather than
   * by convention here.
   */
  @ManyToOne(() => TraceableItem, { nullable: true })
  @JoinColumn({ name: 'item_id' })
  item: TraceableItem | null;

  /**
   * The lot this happened to, for events that precede identity assignment.
   * A unit's timeline includes its batch's events, so a finished laptop can
   * still show what went into making it.
   */
  @ManyToOne(() => Batch, { nullable: true })
  @JoinColumn({ name: 'batch_id' })
  batch: Batch | null;

  @Column({ type: 'enum', enum: EventType, nullable: false, update: false })
  type: EventType;

  @ManyToOne(() => Organization, { nullable: true })
  @JoinColumn({ name: 'source_organization_id' })
  sourceOrganization: Organization | null;

  @ManyToOne(() => Location, { nullable: true })
  @JoinColumn({ name: 'source_location_id' })
  sourceLocation: Location | null;

  @ManyToOne(() => Organization, { nullable: true })
  @JoinColumn({ name: 'destination_organization_id' })
  destinationOrganization: Organization | null;

  @ManyToOne(() => Location, { nullable: true })
  @JoinColumn({ name: 'destination_location_id' })
  destinationLocation: Location | null;

  /** The container involved, for PACKAGED and UNIT_REMOVED. */
  @ManyToOne(() => TraceableItem, { nullable: true })
  @JoinColumn({ name: 'related_item_id' })
  relatedItem: TraceableItem | null;

  @Column({ type: 'int', nullable: true, update: false })
  quantity: number | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  /** Consumer reference on a final sale; readable only with permission. */
  @Column({ name: 'consumer_ref', type: 'varchar', nullable: true, update: false })
  consumerRef: string | null;

  @Column({ name: 'device_id', type: 'varchar', nullable: true, update: false })
  deviceId: string | null;

  /**
   * Client-generated id for offline operations. Unique, so replaying a queue
   * after a reconnect can never duplicate an event (business rule 12).
   */
  @Index({ unique: true })
  @Column({ name: 'client_event_id', type: 'varchar', nullable: true, update: false })
  clientEventId: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true, update: false })
  notes: string | null;

  @ManyToOne(() => TraceabilityEvent, { nullable: true })
  @JoinColumn({ name: 'compensates_event_id' })
  compensates: TraceabilityEvent | null;

  /** When it happened in the field. May predate recording when offline. */
  @Column({
    name: 'occurred_at',
    type: 'timestamptz',
    nullable: false,
    update: false,
  })
  occurredAt: Date;

  /** When the central system stored it. */
  @CreateDateColumn({ name: 'recorded_at' })
  recordedAt: Date;
}
