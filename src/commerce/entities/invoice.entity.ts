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
import { InvoiceStatus } from '../commerce.enums';
import { Customer } from './customer.entity';
import { SalesOrder } from './sales-order.entity';

/**
 * A request for payment raised against a confirmed sales order (proposal
 * section 6). The amounts are snapshots of the order; what the customer still
 * owes is the total minus what payments have covered.
 */
@Entity('invoices')
@Index('idx_invoice_org', ['organization'])
@Index('idx_invoice_customer', ['customer'])
export class Invoice {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'invoice_number', nullable: false })
  invoiceNumber: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Customer, { nullable: false, eager: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @ManyToOne(() => SalesOrder, { nullable: true, eager: true })
  @JoinColumn({ name: 'sales_order_id' })
  salesOrder: SalesOrder | null;

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.DRAFT })
  status: InvoiceStatus;

  @Column({ name: 'issued_on', type: 'date', nullable: true })
  issuedOn: string | null;

  @Column({ name: 'due_on', type: 'date', nullable: true })
  dueOn: string | null;

  @Column({ name: 'subtotal', type: 'numeric', precision: 14, scale: 2, nullable: true })
  subtotal: string | null;

  @Column({ name: 'tax_percent', type: 'numeric', precision: 5, scale: 2, nullable: true })
  taxPercent: string | null;

  @Column({ name: 'total_amount', type: 'numeric', precision: 14, scale: 2, nullable: true })
  totalAmount: string | null;

  /** What the customer has paid so far; the difference is the balance. */
  @Column({ name: 'amount_paid', type: 'numeric', precision: 14, scale: 2, nullable: false, default: '0' })
  amountPaid: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}