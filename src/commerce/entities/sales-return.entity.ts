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
import { ReturnStatus } from '../commerce.enums';
import { Customer } from './customer.entity';
import { Invoice } from './invoice.entity';

/**
 * A customer returning goods, and the refund that follows (proposal section
 * 6, returns and refunds). Returns are commercial records - the physical
 * goods flow back through the existing dispatch/receive machinery separately.
 */
@Entity('sales_returns')
@Index('idx_return_org', ['organization'])
@Index('idx_return_customer', ['customer'])
export class SalesReturn {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'return_number', nullable: false })
  returnNumber: string;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @ManyToOne(() => Customer, { nullable: false, eager: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  /** The invoice the returned goods were billed on, if one exists. */
  @ManyToOne(() => Invoice, { nullable: true, eager: true })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice | null;

  @Column({ type: 'enum', enum: ReturnStatus, default: ReturnStatus.REQUESTED })
  status: ReturnStatus;

  @Column({ type: 'varchar', length: 1000, nullable: false })
  reason: string;

  @Column({ name: 'refund_amount', type: 'numeric', precision: 14, scale: 2, nullable: true })
  refundAmount: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}