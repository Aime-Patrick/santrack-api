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
import { PaymentMethod } from '../commerce.enums';
import { Customer } from './customer.entity';
import { Invoice } from './invoice.entity';

/**
 * A payment received against an invoice (proposal section 6). Recording a
 * payment is what advances the invoice from ISSUED towards PAID - the balance
 * is always the invoice total minus the payments against it.
 */
@Entity('payments')
@Index('idx_payment_org', ['organization'])
@Index('idx_payment_customer', ['customer'])
@Index('idx_payment_invoice', ['invoice'])
export class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'payment_number', nullable: false })
  paymentNumber: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Customer, { nullable: false, eager: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @ManyToOne(() => Invoice, { nullable: false, eager: true })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false })
  amount: string;

  @Column({ type: 'enum', enum: PaymentMethod, nullable: false })
  method: PaymentMethod;

  @Column({ type: 'varchar', nullable: true })
  reference: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'received_by_id' })
  receivedBy: User | null;

  @Column({ name: 'paid_on', type: 'date', nullable: true })
  paidOn: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}