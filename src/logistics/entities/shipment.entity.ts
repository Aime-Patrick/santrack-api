import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { Transfer } from '../../transfer/entities/transfer.entity';
import { ShipmentEventType, ShipmentStatus } from '../logistics.enums';
import { Driver } from './driver.entity';
import { Route } from './route.entity';
import { Transporter } from './transporter.entity';
import { Vehicle } from './vehicle.entity';

/**
 * How a dispatch physically travels. Custody still moves through the existing
 * transfer - dispatch, receipt, cancellation - because that is where the
 * chain-of-custody events are recorded. The shipment is the logistics layer
 * on top: which transporter, vehicle and driver carried the goods, over which
 * route, and when delivery was confirmed (technical proposal section 5:
 * shipment creation, delivery tracking, proof of delivery).
 */
@Entity('shipments')
@Unique('uq_shipments_transfer', ['transfer'])
@Index('idx_shipment_org', ['organization'])
@Index('idx_shipment_destination_org', ['destinationOrganization'])
@Index('idx_shipment_status', ['status'])
export class Shipment {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'shipment_number', nullable: false })
  shipmentNumber: string;

  /** The business whose goods are being moved (the shipper). */
  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /**
   * The dispatch this shipment carries. One shipment per dispatch, so the
   * custody record and its physical journey can never disagree.
   */
  @ManyToOne(() => Transfer, { nullable: false, eager: true })
  @JoinColumn({ name: 'transfer_id' })
  transfer: Transfer;

  @ManyToOne(() => Transporter, { nullable: false, eager: true })
  @JoinColumn({ name: 'transporter_id' })
  transporter: Transporter;

  @ManyToOne(() => Vehicle, { nullable: true, eager: true })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: Vehicle | null;

  @ManyToOne(() => Driver, { nullable: true, eager: true })
  @JoinColumn({ name: 'driver_id' })
  driver: Driver | null;

  @ManyToOne(() => Route, { nullable: true, eager: true })
  @JoinColumn({ name: 'route_id' })
  route: Route | null;

  /** The party receiving the goods; mirrors the transfer's destination. */
  @ManyToOne(() => Organization, { nullable: true, eager: true })
  @JoinColumn({ name: 'destination_organization_id' })
  destinationOrganization: Organization | null;

  @Column({ type: 'enum', enum: ShipmentStatus, default: ShipmentStatus.PENDING })
  status: ShipmentStatus;

  @Column({ name: 'scheduled_departure_on', type: 'date', nullable: true })
  scheduledDepartureOn: string | null;

  @Column({ name: 'scheduled_delivery_on', type: 'date', nullable: true })
  scheduledDeliveryOn: string | null;

  @Column({ name: 'departed_at', type: 'timestamptz', nullable: true })
  departedAt: Date | null;

  /** When delivery was confirmed - the proof-of-delivery timestamp. */
  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  /** Who physically received the goods, as recorded at confirmation. */
  @Column({ name: 'pod_recipient_name', type: 'varchar', nullable: true })
  podRecipientName: string | null;

  @Column({ name: 'pod_notes', type: 'varchar', length: 1000, nullable: true })
  podNotes: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

/** One step in a shipment's tracking history. Append-only. */
@Entity('shipment_events')
@Index('idx_shipment_event_shipment', ['shipment'])
export class ShipmentEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Shipment, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shipment_id' })
  shipment: Shipment;

  @Column({ type: 'enum', enum: ShipmentEventType, nullable: false })
  type: ShipmentEventType;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @Column({ name: 'recorded_at', type: 'timestamptz', default: () => 'now()' })
  recordedAt: Date;
}