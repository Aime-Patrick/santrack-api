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
import { ProductionEventType } from '../manufacturing.enums';
import { ProductionOrder } from './production-order.entity';

/**
 * The append-only history of one production order: when it was created,
 * started, what materials were allocated and issued, and how it finished.
 * Separate from traceability events because these describe the factory, not
 * the product - a recall reaches product records, never these.
 */
@Entity('production_events')
@Index('idx_production_event_order', ['productionOrder'])
export class ProductionEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ProductionOrder, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'production_order_id' })
  productionOrder: ProductionOrder;

  @Column({ type: 'enum', enum: ProductionEventType, nullable: false })
  type: ProductionEventType;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  /** Material quantity this step concerned, when it concerned one. */
  @Column({ type: 'numeric', precision: 14, scale: 3, nullable: true })
  quantity: string | null;

  /** Previous value when amending a produced quantity. */
  @Column({ name: 'previous_quantity', type: 'numeric', precision: 14, scale: 3, nullable: true })
  previousQuantity: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;
}
