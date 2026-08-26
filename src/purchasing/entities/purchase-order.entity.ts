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
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import { PurchaseOrderStatus } from '../purchasing.enums';
import { Supplier } from './supplier.entity';

/**
 * Buyer purchase order for finished goods (DR-10). Commercial paper only in
 * v1: confirm and receive do not move stock. Physical inbound remains Transfer
 * receive.
 */
@Entity('purchase_orders')
@Index('idx_po_org', ['organization'])
@Index('idx_po_supplier', ['supplier'])
export class PurchaseOrder {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'po_number', nullable: false })
  poNumber: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Supplier, { nullable: false, eager: true })
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;

  @Column({
    type: 'enum',
    enum: PurchaseOrderStatus,
    default: PurchaseOrderStatus.DRAFT,
  })
  status: PurchaseOrderStatus;

  @Column({ name: 'expected_on', type: 'date', nullable: true })
  expectedOn: string | null;

  @Column({ name: 'subtotal', type: 'numeric', precision: 14, scale: 2, nullable: true })
  subtotal: string | null;

  @Column({ name: 'tax_percent', type: 'numeric', precision: 5, scale: 2, nullable: true })
  taxPercent: string | null;

  @Column({ name: 'total_amount', type: 'numeric', precision: 14, scale: 2, nullable: true })
  totalAmount: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('purchase_order_lines')
@Index('idx_po_line_order', ['purchaseOrder'])
export class PurchaseOrderLine {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => PurchaseOrder, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'purchase_order_id' })
  purchaseOrder: PurchaseOrder;

  /** Buyer's catalogue product — what they will stock (DR-10 D3). */
  @ManyToOne(() => Product, { nullable: false, eager: true })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 3, nullable: false })
  quantity: string;

  @Column({ name: 'unit_price', type: 'numeric', precision: 14, scale: 2, nullable: false })
  unitPrice: string;

  @Column({ name: 'line_total', type: 'numeric', precision: 14, scale: 2, nullable: true })
  lineTotal: string | null;

  /**
   * Commercial receive progress only. Does not put goods on hand — Transfer
   * receive does that (DR-10 D4).
   */
  @Column({
    name: 'received_quantity',
    type: 'numeric',
    precision: 14,
    scale: 3,
    default: 0,
  })
  receivedQuantity: string;
}
