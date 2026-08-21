import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TraceableItem } from '../../item/entities/traceable-item.entity';
import { SalesOrder } from './sales-order.entity';
import { SalesOrderLine } from './sales-order.entity';

/**
 * A commitment of specific product identities to a sales order line.
 *
 * Created by confirm() using FEFO (First Expired, First Out): the items
 * expiring soonest are reserved first, because they are the ones the seller
 * most needs to move before they become unsellable.
 *
 * Reserved items carry ItemStatus.RESERVED: they cannot be sold to another
 * customer, dispatched on a different order, or relocated away from where
 * fulfilment expects to find them.  fulfil() reads these rows to know
 * exactly what to dispatch.
 */
@Entity('sales_order_reservations')
@Index('idx_reservation_order', ['order'])
@Index('idx_reservation_item', ['item'])
export class SalesOrderReservation {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => SalesOrder, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: SalesOrder;

  @ManyToOne(() => SalesOrderLine, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_line_id' })
  orderLine: SalesOrderLine;

  @ManyToOne(() => TraceableItem, { nullable: false, eager: true })
  @JoinColumn({ name: 'item_id' })
  item: TraceableItem;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @CreateDateColumn({ name: 'reserved_at', type: 'timestamptz' })
  reservedAt: Date;
}
