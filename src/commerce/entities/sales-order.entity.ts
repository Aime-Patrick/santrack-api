import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import { SalesOrderStatus } from '../commerce.enums';
import { Customer } from './customer.entity';
import { Quotation } from './quotation.entity';
import { SalesOrderReservation } from './sales-order-reservation.entity';

/**
 * A customer's commitment to buy (proposal section 6). May be raised from an
 * accepted quotation; lines are a snapshot so the order stays what was agreed.
 */
@Entity('sales_orders')
@Index('idx_order_org', ['organization'])
@Index('idx_order_customer', ['customer'])
export class SalesOrder {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'order_number', nullable: false })
  orderNumber: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Customer, { nullable: false, eager: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @ManyToOne(() => Quotation, { nullable: true, eager: true })
  @JoinColumn({ name: 'quotation_id' })
  quotation: Quotation | null;

  @Column({ type: 'enum', enum: SalesOrderStatus, default: SalesOrderStatus.PLACED })
  status: SalesOrderStatus;

  @Column({ name: 'requested_delivery_on', type: 'date', nullable: true })
  requestedDeliveryOn: string | null;

  @Column({ name: 'subtotal', type: 'numeric', precision: 14, scale: 2, nullable: true })
  subtotal: string | null;

  @Column({ name: 'tax_percent', type: 'numeric', precision: 5, scale: 2, nullable: true })
  taxPercent: string | null;

  @Column({ name: 'total_amount', type: 'numeric', precision: 14, scale: 2, nullable: true })
  totalAmount: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  /** Set once fulfil() creates a transfer to dispatch the reserved goods. */
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  /**
   * The transfer that dispatches the reserved goods to the buyer. Set only
   * when the customer is a registered organization; an off-platform customer
   * gets `saleId` instead.
   */
  @Column({ name: 'transfer_id', type: 'int', nullable: true })
  transferId: number | null;

  /**
   * The sale that took the goods out of the chain, for a customer that is not
   * an organization on the platform. Exactly one of this and `transferId` is
   * set once the order is fulfilled.
   */
  @Column({ name: 'sale_id', type: 'int', nullable: true })
  saleId: number | null;

  /**
   * When fulfilment rounds up from the requested quantity (sales unit finer
   * than identity size), the customer must accept the difference before
   * confirm. Null means no rounding was needed, or it has not been accepted.
   */
  @Column({ name: 'rounding_accepted_at', type: 'timestamptz', nullable: true })
  roundingAcceptedAt: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'rounding_accepted_by_id' })
  roundingAcceptedBy: User | null;

  /** The identities committed to this order by confirm(). */
  @OneToMany(() => SalesOrderReservation, (r) => r.order)
  reservations: SalesOrderReservation[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('sales_order_lines')
@Index('idx_order_line_order', ['order'])
export class SalesOrderLine {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => SalesOrder, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: SalesOrder;

  @ManyToOne(() => Product, { nullable: false, eager: true })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  /**
   * What the customer asked for, in {@link salesUnit}. Written once at entry;
   * never overwritten by warehouse rounding (DR-09 D2).
   */
  @Column({ name: 'requested_quantity', type: 'numeric', precision: 14, scale: 3, nullable: false })
  requestedQuantity: string;

  /**
   * Commercial unit the deal was struck in. Null on historic rows = bare
   * product units (no pack conversion).
   */
  @Column({ name: 'sales_unit', type: 'varchar', nullable: true })
  salesUnit: string | null;

  /**
   * Product units required to satisfy the request with whole identities.
   * Null until confirm(); backfilled to requested on migration for old rows.
   */
  @Column({ name: 'fulfilment_quantity', type: 'numeric', precision: 14, scale: 3, nullable: true })
  fulfilmentQuantity: string | null;

  @Column({ name: 'unit_price', type: 'numeric', precision: 14, scale: 2, nullable: false })
  unitPrice: string;

  @Column({ name: 'line_total', type: 'numeric', precision: 14, scale: 2, nullable: true })
  lineTotal: string | null;
}